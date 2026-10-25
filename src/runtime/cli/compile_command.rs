mod build;
mod command;
mod configuration;
mod entry_points;
mod failure;
mod library;
mod printing;
mod reports;
mod trimming;

use core::ptr::NonNull;
use core::time::Duration;

use bun_aot::report::ReportMessage;
use bun_bundler::aot::PluginSetup;
use bun_bundler::bundle_v2::FileMap;
use bun_bundler::linker_context_mod::EventLoop;
use bun_bundler::options::OutputFile;
use bun_bundler::transpiler::Transpiler;
use bun_exe_format::identity::IdentityError;
use bun_options_types::WindowsOptions;
use bun_options_types::aot_options::AotOptions;
use bun_options_types::compile_target::CompileTarget;
use bun_standalone_graph::StandaloneModuleGraph::{
    CompileError, ExecutableDetails, Flags, RuntimeOptions,
};
use bun_sys::Fd;
use bun_trim::TrimError;

pub(crate) use self::build::compile_to_executable;
pub(crate) use self::command::compile_from_context;
pub(crate) use self::configuration::DEFAULT_LIBRARY_OUTDIR;
pub(crate) use self::library::{
    TypedOutputs, add_declaration_files, add_package_files, add_typed_files, configure_library,
    is_declaration_file, is_typed_file,
};
pub(crate) use self::printing::{
    exit_with_failure, print_error_and_notes, print_failure, print_log, print_report_log,
    write_trimmed_size,
};
pub(crate) use self::trimming::{plan_trimming, trim_settings_of};

pub(crate) struct CompileCommand;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum RequestOrigin {
    CompileCommand,
    BuildFlag,
    BuildApi,
}

impl RequestOrigin {
    pub(crate) fn subject(self) -> &'static str {
        match self {
            RequestOrigin::CompileCommand => "bun compile",
            RequestOrigin::BuildFlag => "--aot",
            RequestOrigin::BuildApi => "compile.aot",
        }
    }
}

#[derive(Copy, Clone)]
pub(crate) enum CompileProduct<'r> {
    Executable { outfile: &'r [u8] },
    GraphBytes,
    ReportsOnly,
}

pub(crate) struct BundlerInputs<'a> {
    pub(crate) transpiler: &'a mut Transpiler<'a>,
    pub(crate) arena: &'a bun_alloc::Arena,
    pub(crate) event_loop: EventLoop,
    pub(crate) worker_pool: Option<NonNull<bun_threading::ThreadPool>>,
    pub(crate) plugins: Option<PluginSetup>,
    pub(crate) file_map: Option<&'a FileMap>,
}

pub(crate) struct ExecutableSettings<'r> {
    pub(crate) target: &'r CompileTarget,
    pub(crate) executable_path: Option<&'r [u8]>,
    pub(crate) root_dir: Fd,
    pub(crate) env: &'r mut bun_dotenv::Loader,
    pub(crate) windows: &'r WindowsOptions,
    pub(crate) exec_argv: &'r [u8],
    pub(crate) flags: Flags,
    pub(crate) runtime_options: RuntimeOptions,
    pub(crate) assets: &'r [Box<[u8]>],
    pub(crate) embeds_source_maps: bool,
}

pub(crate) struct CompileRequest<'r, 'a> {
    pub(crate) origin: RequestOrigin,
    pub(crate) product: CompileProduct<'r>,
    pub(crate) options: &'r AotOptions,
    pub(crate) entry_points: &'r [&'r [u8]],
    pub(crate) bundler: Option<BundlerInputs<'a>>,
    pub(crate) executable: ExecutableSettings<'r>,
    pub(crate) log: &'r mut bun_ast::Log,
}

pub(crate) struct CompileOutcome {
    pub(crate) output_files: Vec<OutputFile>,
    pub(crate) graph_bytes: Option<Vec<u8>>,
    pub(crate) metafile: Option<Vec<u8>>,
    pub(crate) summary: Vec<u8>,
    pub(crate) report_messages: Vec<ReportMessage>,
    pub(crate) trim_log_lines: Vec<Vec<u8>>,
    pub(crate) executable: Option<ExecutableDetails>,
    pub(crate) untyped_note: Vec<u8>,
    pub(crate) module_count: u32,
    pub(crate) engine_time: Duration,
    pub(crate) executable_time: Duration,
}

pub(crate) enum CompileFailure {
    NoCompiler,
    CrossCompilation,
    NoIdentity(IdentityError),
    TemplateUnreadable {
        error: bun_sys::Error,
    },
    TemplateIsNotBun {
        path: Vec<u8>,
    },
    TemplateDiffers {
        path: Vec<u8>,
        difference: Vec<u8>,
    },
    /// `files_checked`: 0 where the build ended before it had counted them.
    Build {
        refused_entry_points: Option<Vec<u32>>,
        files_checked: u32,
    },
    Assets(String),
    Trim(TrimError),
    Executable(CompileError),
    Graph(bun_standalone_graph::Error),
    FileNotWritten {
        path: Vec<u8>,
        error: bun_sys::Error,
    },
}
