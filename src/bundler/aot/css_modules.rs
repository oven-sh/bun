use std::borrow::Cow;

use bun_alloc::Arena;
use bun_aot::load::source_provider::{Failed, SourceFile};
use bun_ast::{ImportKind, ImportRecord, Index, Loader, Loc, Log, Source, Symbol};
use bun_core::strings::BOM;
use bun_paths::fs::Path;
use bun_sema::atom::Interner;
use bun_sema::hir_from_data::DataValue;

use super::services::BuildContext;
use crate::Transpiler;
pub(crate) use crate::bun_css::css_modules::is_module_path;
use crate::bun_css::css_modules::{
    ComposesGraph, ComposesVisitor, Config, ExportedName, scoped_name,
};
use crate::bun_css::{BundlerStyleSheet, ParserOptions};
use crate::bun_fs::FileSystem;

struct Sheet {
    source: Source<'static>,
    sheet: Option<BundlerStyleSheet>,
    symbols: Vec<Symbol>,
    import_records: Vec<ImportRecord<'static>>,
}

struct Sheets(Vec<Sheet>);

struct NestsTooDeeply;

impl ComposesGraph for Sheets {
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

fn without_byte_order_mark(contents: Vec<u8>) -> Vec<u8> {
    match BOM::detect(&contents) {
        Some(mark) => mark.remove_and_convert_to_utf8_and_free(contents),
        None => contents,
    }
}

fn read(bump: &'static Arena, path: &[u8]) -> Option<&'static [u8]> {
    let contents = bun_sys::File::read_from(bun_sys::Fd::cwd(), path).ok()?;
    Some(bump.alloc_slice_copy(&without_byte_order_mark(contents)))
}

fn is_sheet(transpiler: &Transpiler<'static>, path: &Path<'_>) -> bool {
    if path.is_data_url() {
        return false;
    }
    let extension = path.name().ext;
    let by_option = transpiler.options.loaders.get(extension).copied();
    by_option.or_else(|| Loader::from_string(extension)) == Some(Loader::Css)
}

fn parse(
    transpiler: &Transpiler<'static>,
    bump: &'static Arena,
    source_index: usize,
    path_text: &[u8],
    contents: Option<&'static [u8]>,
    skipped: &mut Log,
) -> Result<Sheet, NestsTooDeeply> {
    let top_level_dir = FileSystem::get().top_level_dir();
    let mut path = Path::init(&*bump.alloc_slice_copy(path_text));
    if path_text.len() + 2 * top_level_dir.len() < bun_paths::MAX_PATH_BYTES {
        let target = transpiler.options.target;
        path = crate::generic_path_with_pretty_initialized(&path, target, top_level_dir, bump)
            .map_err(|_| NestsTooDeeply)?;
    }
    let mut file = Sheet {
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

    let mut options = ParserOptions::default(Some(skipped));
    options.error_recovery = true;
    if is_module_path(path.pretty) {
        options.filename = path.pretty;
        options.css_modules = Some(Config::default());
    }
    let index = Index::init(source_index);
    match BundlerStyleSheet::parse_bundler(bump, contents, options, &mut file.import_records, index)
    {
        Ok((sheet, extra)) => {
            file.sheet = Some(sheet);
            file.symbols = extra.symbols;
            Ok(file)
        }
        Err(_) => Err(NestsTooDeeply),
    }
}

impl Sheets {
    fn load(
        &mut self,
        transpiler: &mut Transpiler<'static>,
        bump: &'static Arena,
        path_text: &[u8],
        contents: &'static [u8],
        skipped: &mut Log,
    ) -> Result<(), NestsTooDeeply> {
        let first = parse(transpiler, bump, 0, path_text, Some(contents), skipped)?;
        self.0.push(first);

        let mut source_index = 0;
        while source_index < self.0.len() {
            for record_index in 0..self.0[source_index].import_records.len() {
                let file = &self.0[source_index];
                let record = &file.import_records[record_index];
                if record.kind != ImportKind::Composes {
                    continue;
                }
                let resolver = &mut transpiler.resolver;
                let log_of_build =
                    core::mem::replace(&mut resolver.log, core::ptr::NonNull::from(&mut *skipped));
                let resolved =
                    resolver.resolve(file.source.path.source_dir(), record.path.text, record.kind);
                resolver.log = log_of_build;
                let Ok(mut resolved) = resolved else {
                    continue;
                };
                if resolved.flags.is_external() {
                    continue;
                }
                let Some(path) = resolved.path().map(|path| *path) else {
                    continue;
                };
                let known = self
                    .0
                    .iter()
                    .position(|it| it.source.path.text == path.text);
                let composed_index = match known {
                    Some(index) => index,
                    None => {
                        let contents = match is_sheet(transpiler, &path) {
                            true => match read(bump, path.text) {
                                Some(contents) => Some(contents),
                                None => continue,
                            },
                            false => None,
                        };
                        let index = self.0.len();
                        let composed =
                            parse(transpiler, bump, index, path.text, contents, skipped)?;
                        self.0.push(composed);
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

    fn exports(
        &self,
        scratch: &Arena,
        skipped: &mut Log,
    ) -> Result<Vec<(&[u8], Vec<u8>)>, NestsTooDeeply> {
        let Some(sheet) = self.0.first().and_then(|file| file.sheet.as_ref()) else {
            return Ok(Vec::new());
        };
        let mut visitor = ComposesVisitor::new(self);
        let mut exports = Vec::with_capacity(sheet.local_scope.count());
        for (local_name, local) in sheet.local_scope.iter() {
            let mut value = Vec::new();
            for name in visitor.exported_names(sheet, local.ref_, 0, skipped) {
                if !value.is_empty() {
                    value.push(b' ');
                }
                match *name {
                    ExportedName::Local(ref_) => {
                        let file = &self.0[ref_.source_index() as usize];
                        let symbol = &file.symbols[ref_.inner_index() as usize];
                        let pretty = file.source.path.pretty;
                        value.extend_from_slice(&scoped_name(
                            scratch,
                            pretty,
                            symbol.original_name.slice(),
                        ));
                    }
                    ExportedName::Global(name) => value.extend_from_slice(name),
                }
            }
            if visitor.out_of_stack {
                return Err(NestsTooDeeply);
            }
            exports.push((&**local_name, value));
        }
        Ok(exports)
    }
}

fn collect<'s>(
    transpiler: &mut Transpiler<'static>,
    file: &SourceFile<'_>,
    atoms: &Interner<'s>,
) -> Result<Vec<(bun_sema::atom::Atom, DataValue<'s>)>, NestsTooDeeply> {
    let arena = Arena::new();
    // SAFETY: only `sheets` borrows from `arena`. It is declared behind it, so it drops first, and what leaves this function is interned.
    let bump: &'static Arena = unsafe { bun_ptr::detach_lifetime_ref(&arena) };
    let mut sheets = Sheets(Vec::new());
    let mut skipped = Log::init();
    let contents = bump.alloc_slice_copy(&without_byte_order_mark(file.contents.to_vec()));
    sheets.load(transpiler, bump, file.path, contents, &mut skipped)?;
    let exports = sheets.exports(bump, &mut skipped)?;
    let intern = |(name, value): &(&[u8], Vec<u8>)| {
        (atoms.intern(name), DataValue::String(atoms.intern(value)))
    };
    Ok(exports.iter().map(intern).collect())
}

pub(crate) fn exported_names<'s>(
    context: &BuildContext,
    file: &SourceFile<'_>,
    arena: &'s Arena,
    atoms: &Interner<'s>,
    log: &mut Log,
) -> Result<&'s DataValue<'s>, Failed> {
    match context.with_worker(|transpiler, _| collect(transpiler, file, atoms)) {
        Ok(names) => Ok(arena.alloc(DataValue::Object(arena.alloc_slice_copy(&names)))),
        Err(NestsTooDeeply) => {
            let source = Source::init_path_string(file.path, file.contents);
            log.add_error(
                Some(&source),
                Loc::EMPTY,
                b"The CSS module nests too deeply",
            );
            Err(Failed)
        }
    }
}
