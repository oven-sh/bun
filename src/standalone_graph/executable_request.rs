use bun_bundler::options::OutputFile;
use bun_core::{StringBuilder, StringPointer};
use bun_exe_format::macho::MachoFile;
use bun_options_types::bundle_enums::{Format, WindowsOptions};
use bun_sys::Fd;

use crate::StandaloneModuleGraph::{
    CompileResult, CompileTarget, Flags, RuntimeOptions, to_bytes, to_executable,
};
use crate::compiled_program::{CompiledProgramInput, EntryPointPathPointers, append_record};
use crate::executable_file::{ImageRange, ImageSymbols};

pub struct GraphRequest<'a> {
    pub target: &'a CompileTarget,
    pub output_files: &'a [OutputFile],
    pub module_prefix: &'a [u8],
    pub output_format: Format,
    pub exec_argv: &'a [u8],
    pub flags: Flags,
    pub runtime_options: RuntimeOptions,
    pub compiled_program: Option<CompiledProgramInput<'a>>,
}

pub struct ExecutableRequest<'a> {
    pub graph: GraphRequest<'a>,
    pub root_dir: Fd,
    pub outfile: &'a [u8],
    pub env: &'a mut bun_dotenv::Loader,
    pub windows: &'a WindowsOptions,
    pub executable_path: Option<&'a [u8]>,
    pub trim: Option<&'a bun_trim::TrimPlan>,
}

#[derive(Default)]
pub struct ExecutableDetails {
    pub trim_summary: Option<bun_trim::TrimSummary>,
    /// Bytes of the file, before Windows metadata is edited.
    pub size: u64,
    /// `bun_exe_format::build_id`, for an executable that holds a compiled program.
    pub build_id: Option<[u8; bun_exe_format::build_id::SIZE]>,
}

pub struct ExecutableOutcome {
    pub result: CompileResult,
    /// `Some` if and only if `result` is `Success`.
    pub details: Option<ExecutableDetails>,
}

/// What `to_executable` takes and gives beyond a bundled program. The default adds nothing.
#[derive(Default)]
pub struct ExecutableAdditions<'a> {
    pub compiled_program: Option<&'a CompiledProgramInput<'a>>,
    pub trim: Option<&'a bun_trim::TrimPlan>,
    /// Filled once the copy of the executable is written. Meaningful if the result is `Success`.
    pub details: ExecutableDetails,
}

#[derive(Default)]
pub(crate) struct GraphBytes {
    pub(crate) bytes: Vec<u8>,
    pub(crate) image: Option<ImageRange>,
}

pub(crate) struct InjectionAdditions<'a> {
    pub(crate) has_code: bool,
    pub(crate) image: Option<ImageRange>,
    pub(crate) symbols: Option<ImageSymbols<'a>>,
    pub(crate) has_symbols: bool,
    build_id: Option<[u8; bun_exe_format::build_id::SIZE]>,
    trim: Option<&'a bun_trim::TrimPlan>,
    trim_summary: Option<bun_trim::TrimSummary>,
}

impl<'a> ExecutableAdditions<'a> {
    pub(crate) fn for_injection(&self, image: Option<ImageRange>) -> InjectionAdditions<'a> {
        let symbols = self
            .compiled_program
            .filter(|program| !program.symbols.is_empty())
            .zip(image)
            .map(|(program, image)| ImageSymbols {
                table: program.symbols,
                image_offset: u64::from(image.offset),
            });
        InjectionAdditions {
            has_code: self.compiled_program.is_some(),
            image,
            symbols,
            has_symbols: false,
            build_id: None,
            trim: self.trim,
            trim_summary: None,
        }
    }
}

impl InjectionAdditions<'_> {
    /// `payload` is what the executable gets, with the image as the compiler made it.
    pub(crate) fn name_executable(&mut self, payload: &[u8]) {
        self.build_id = self
            .has_code
            .then(|| bun_exe_format::build_id::compute(payload));
    }

    pub(crate) fn write_build_id(&mut self, template: &mut [u8]) {
        self.build_id = self
            .build_id
            .filter(|id| bun_exe_format::build_id::write(template, id));
    }

    /// False: the error has been printed.
    pub(crate) fn edit_template(
        &mut self,
        template: &mut dyn bun_exe_format::image::ImageBytes,
    ) -> bool {
        self.write_build_id(template);
        let Some(plan) = self.trim else {
            return true;
        };
        match bun_trim::apply(template, plan) {
            Ok(summary) => {
                self.trim_summary = Some(summary);
                true
            }
            Err(error) => {
                let mut message: Vec<u8> = Vec::new();
                error.write_message(&mut message);
                bun_core::pretty_errorln!("<r><red>error<r><d>:<r> {}", bstr::BStr::new(&message));
                false
            }
        }
    }

    pub(crate) fn add_macho_symbols(&mut self, file: &mut MachoFile) {
        self.has_symbols = self.symbols.is_some_and(|symbols| {
            file.add_symbols(symbols.table, symbols.image_offset)
                .is_some()
        });
    }

    pub(crate) fn trims(&self) -> bool {
        self.trim.is_some()
    }

    pub(crate) fn needs_executable_format(&self) -> bool {
        self.has_code || self.trim.is_some()
    }

    pub(crate) fn into_details(self, file: Fd) -> ExecutableDetails {
        if self.symbols.is_some() && !self.has_symbols {
            bun_core::warn!("could not add symbols of compiled functions to this executable");
        }
        ExecutableDetails {
            trim_summary: self.trim_summary,
            size: bun_sys::get_file_size(file).unwrap_or(0),
            build_id: self.build_id,
        }
    }
}

pub(crate) fn append_compiled_program_record(
    builder: &mut StringBuilder,
    program: &CompiledProgramInput<'_>,
    image: StringPointer,
    paths: &[EntryPointPathPointers],
    module_files: &[&OutputFile],
) -> crate::Result<()> {
    let mut file_indices: Vec<Option<u32>> = vec![None; program.entry_points.len()];
    for (index, file) in module_files.iter().enumerate() {
        let Some(entry_point_index) = file.entry_point_index else {
            continue;
        };
        let slot = file_indices
            .get_mut(entry_point_index as usize)
            .ok_or(crate::Error::CorruptedCompiledProgram)?;
        if slot.replace(index as u32).is_some() {
            return Err(crate::Error::CorruptedCompiledProgram);
        }
    }
    append_record(builder, program, image, paths, &file_indices)
}

pub(crate) fn graph_bytes(request: &GraphRequest<'_>) -> crate::Result<GraphBytes> {
    to_bytes(
        request.target,
        request.module_prefix,
        request.output_files,
        request.output_format,
        request.exec_argv,
        request.flags,
        request.runtime_options,
        request.compiled_program.as_ref(),
    )
}

/// `[u64 LE length][graph]`: what the section of an executable holds.
pub fn to_graph_bytes(request: &GraphRequest<'_>) -> crate::Result<Vec<u8>> {
    let graph = graph_bytes(request)?;
    if graph.bytes.is_empty() {
        return Err(crate::Error::CorruptedCompiledProgram);
    }
    let mut bytes: Vec<u8> = Vec::with_capacity(size_of::<u64>() + graph.bytes.len());
    bytes.extend_from_slice(&(graph.bytes.len() as u64).to_le_bytes());
    bytes.extend_from_slice(&graph.bytes);
    Ok(bytes)
}

pub fn write_executable(request: &mut ExecutableRequest<'_>) -> crate::Result<ExecutableOutcome> {
    let graph = &request.graph;
    let mut additions = ExecutableAdditions {
        compiled_program: graph.compiled_program.as_ref(),
        trim: request.trim,
        details: ExecutableDetails::default(),
    };
    let result = to_executable(
        graph.target,
        graph.output_files,
        request.root_dir,
        graph.module_prefix,
        request.outfile,
        request.env,
        graph.output_format,
        request.windows,
        graph.exec_argv,
        request.executable_path,
        graph.flags,
        graph.runtime_options,
        &mut additions,
    )?;
    let details = matches!(result, CompileResult::Success).then_some(additions.details);
    Ok(ExecutableOutcome { result, details })
}
