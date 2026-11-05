use std::borrow::Cow;

use bstr::BStr;
use bun_alloc::Arena;
use bun_ast::{ImportKind, ImportRecord, Index, Loader, Loc, Log, Source, Symbol};
use bun_core::strings::BOM;

use crate::bun_css::css_modules::{
    ComposesGraph, ComposesVisitor, Config, ExportedName, is_module_path, scoped_name,
};
use crate::bun_css::{BundlerStyleSheet, ParserOptions};
use crate::bun_fs::{FileSystem, Path, PathResolverExt as _, as_interned_path};
use crate::{Transpiler, generic_path_with_pretty_initialized};

bun_core::declare_scope!(CssModule, hidden);

pub struct StackOverflow;

/// Whoever imports a CSS module without bundling it.
pub trait Host {
    fn transpiler(&mut self) -> &mut Transpiler<'static>;

    /// `path` is a file that a `composes` names.
    fn watch(&mut self, _path: &[u8]) {}

    /// For a process that loads a module many times: a path that isn't interned may be added to the `FilenameStore` each time.
    fn intern(&mut self, _path: &[u8]) -> Option<&'static [u8]> {
        None
    }
}

impl Host for Transpiler<'static> {
    fn transpiler(&mut self) -> &mut Transpiler<'static> {
        self
    }
}

pub(crate) fn without_bom(contents: Vec<u8>) -> Vec<u8> {
    match BOM::detect(&contents) {
        Some(bom) => bom.remove_and_convert_to_utf8_and_free(contents),
        None => contents,
    }
}

/// `None` when the file can't be read. `log` says why.
pub fn read(path_text: &[u8], log: &mut Log) -> Option<Vec<u8>> {
    match bun_sys::File::read_from(bun_sys::Fd::cwd(), path_text) {
        Ok(contents) => Some(without_bom(contents)),
        Err(err) => {
            log.add_error_fmt(
                None,
                Loc::EMPTY,
                format_args!(
                    "{} reading \"{}\"",
                    BStr::new(err.name()),
                    BStr::new(path_text),
                ),
            );
            None
        }
    }
}

struct CssModuleFile {
    source: Source<'static>,
    /// `None` when the file's loader is not CSS.
    sheet: Option<BundlerStyleSheet>,
    symbols: Vec<Symbol>,
    import_records: Vec<ImportRecord<'static>>,
}

impl CssModuleFile {
    /// Parses like the bundler, but skips invalid CSS the way a browser does instead of failing the import.
    fn parse(
        host: &mut dyn Host,
        bump: &'static Arena,
        source_index: usize,
        path_text: &[u8],
        contents: Option<&'static [u8]>,
        log: &mut Log,
    ) -> Result<CssModuleFile, StackOverflow> {
        let top_level_dir = FileSystem::get().top_level_dir();
        let interned = host
            .intern(path_text)
            .or_else(|| as_interned_path(path_text));
        let mut path = Path::init(interned.unwrap_or_else(|| bump.alloc_slice_copy(path_text)));
        // The pretty path must fit a path buffer. Worst case is "../" per `top_level_dir` component plus `path_text`.
        if path_text.len() + 2 * top_level_dir.len() < bun_paths::MAX_PATH_BYTES {
            path = bun_core::handle_oom(generic_path_with_pretty_initialized(
                &path,
                host.transpiler().options.target,
                top_level_dir,
                bump,
            ));
        }
        let mut file = CssModuleFile {
            source: Source {
                path,
                ..Default::default()
            },
            sheet: None,
            symbols: Vec::new(),
            import_records: Vec::new(),
        };
        let Some(contents) = contents else {
            return Ok(file);
        };
        file.source.contents = Cow::Borrowed(contents);

        let mut options = ParserOptions::default(Some(log));
        options.error_recovery = true;
        if is_module_path(path.pretty) {
            options.filename = path.pretty;
            options.css_modules = Some(Config::default());
        }
        match BundlerStyleSheet::parse_bundler(
            bump,
            contents,
            options,
            &mut file.import_records,
            Index::init(source_index),
        ) {
            Ok((sheet, extra)) => {
                file.sheet = Some(sheet);
                file.symbols = extra.symbols;
                Ok(file)
            }
            // With `error_recovery` on, the parser only fails when it runs out of stack.
            Err(_) => Err(StackOverflow),
        }
    }
}

struct CssModuleGraph(Vec<CssModuleFile>);

impl ComposesGraph for CssModuleGraph {
    fn stylesheet(&self, source_index: u32) -> Option<&BundlerStyleSheet> {
        self.0[source_index as usize].sheet.as_ref()
    }

    fn source(&self, source_index: u32) -> &Source<'_> {
        &self.0[source_index as usize].source
    }

    fn import_record(&self, source_index: u32, import_record_index: u32) -> &ImportRecord<'_> {
        &self.0[source_index as usize].import_records[import_record_index as usize]
    }
}

impl CssModuleGraph {
    fn load(
        &mut self,
        host: &mut dyn Host,
        bump: &'static Arena,
        path_text: &[u8],
        contents: &'static [u8],
        log: &mut Log,
    ) -> Result<(), StackOverflow> {
        self.0.push(CssModuleFile::parse(
            host,
            bump,
            0,
            path_text,
            Some(contents),
            log,
        )?);

        let mut source_index = 0;
        while source_index < self.0.len() {
            for record_index in 0..self.0[source_index].import_records.len() {
                let file = &self.0[source_index];
                let record = &file.import_records[record_index];
                if record.kind != ImportKind::Composes {
                    continue;
                }
                let resolver = &mut host.transpiler().resolver;
                let resolver_log =
                    core::mem::replace(&mut resolver.log, core::ptr::NonNull::from(&mut *log));
                let resolved =
                    resolver.resolve(file.source.path.source_dir(), record.path.text, record.kind);
                resolver.log = resolver_log;
                let mut resolved = match resolved {
                    Ok(resolved) => resolved,
                    Err(_) => continue,
                };
                if resolved.flags.is_external() {
                    continue;
                }
                let Some(path) = resolved.path().map(|path| *path) else {
                    continue;
                };
                let composed_index = match self
                    .0
                    .iter()
                    .position(|file| file.source.path.text == path.text)
                {
                    Some(index) => index,
                    None => {
                        host.watch(path.text);
                        let loaders = &host.transpiler().options.loaders;
                        let contents = if path.loader(loaders) == Some(Loader::Css) {
                            match read(path.text, log) {
                                Some(contents) => Some(&*bump.alloc_slice_copy(&contents)),
                                None => continue,
                            }
                        } else {
                            None
                        };
                        let index = self.0.len();
                        self.0.push(CssModuleFile::parse(
                            host, bump, index, path.text, contents, log,
                        )?);
                        index
                    }
                };
                self.0[source_index].import_records[record_index].source_index =
                    Index::init(composed_index);
            }
            source_index += 1;
        }
        Ok(())
    }

    /// Pairs each local name in the first file with the space-separated class names it exports.
    fn exports(
        &self,
        scratch: &Arena,
        log: &mut Log,
    ) -> Result<Vec<(Vec<u8>, Vec<u8>)>, StackOverflow> {
        let Some(sheet) = self.0.first().and_then(|file| file.sheet.as_ref()) else {
            return Ok(Vec::new());
        };
        let mut visitor = ComposesVisitor::new(self);
        let mut exports = Vec::with_capacity(sheet.local_scope.count());
        for (local_name, local) in sheet.local_scope.iter() {
            let mut value = Vec::new();
            for name in visitor.exported_names(sheet, local.ref_, 0, log) {
                if !value.is_empty() {
                    value.push(b' ');
                }
                match *name {
                    ExportedName::Local(ref_) => {
                        let file = &self.0[ref_.source_index() as usize];
                        value.extend_from_slice(&scoped_name(
                            scratch,
                            file.source.path.pretty,
                            file.symbols[ref_.inner_index() as usize]
                                .original_name
                                .slice(),
                        ));
                    }
                    ExportedName::Global(name) => value.extend_from_slice(name),
                }
            }
            if visitor.out_of_stack {
                return Err(StackOverflow);
            }
            exports.push((local_name.to_vec(), value));
        }
        Ok(exports)
    }
}

/// Pairs each local name in the CSS module with what `Bun.build` exports under it.
pub fn load_exports(
    host: &mut dyn Host,
    path_text: &[u8],
    contents: &[u8],
) -> Result<Vec<(Vec<u8>, Vec<u8>)>, StackOverflow> {
    let arena = Arena::new();
    // SAFETY: only `graph` and `skipped` borrow from `arena`; they're declared after it, so they drop first.
    let bump: &'static Arena = unsafe { bun_ptr::detach_lifetime_ref(&arena) };
    let mut graph = CssModuleGraph(Vec::new());
    let mut skipped = Log::init();

    let contents = bump.alloc_slice_copy(contents);
    graph.load(host, bump, path_text, contents, &mut skipped)?;
    let exports = graph.exports(bump, &mut skipped)?;
    for msg in &skipped.msgs {
        bun_core::scoped_log!(
            CssModule,
            "{}: skipped: {}",
            BStr::new(path_text),
            BStr::new(&msg.data.text),
        );
    }
    Ok(exports)
}
