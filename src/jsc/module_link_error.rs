//! Where the statement that a module link error is about is, in the source its module was written in. JavaScriptCore
//! holds the transpiled text, so `Bun__locateModuleLinkError` (FormatStackTraceForJS.cpp) asks here.

use bun_ast::Loc;
use bun_ast::stmt::Data as StmtData;
use bun_js_parser::parse::parse_entry::{Options, ParsedOnly, parse_only_source};
use bun_resolver::fs::PathResolverExt as _;

use crate::module_loader::ModuleLoader;
use crate::virtual_machine::VirtualMachine;

/// `JSC::ModuleLinkErrorSite`: which statement of the importing module, and what the name that comes with it names.
#[repr(u8)]
#[derive(Clone, Copy)]
pub enum Site {
    /// An import. The name is its local binding.
    Import = 0,
    /// `export { x } from`, or an import that is exported. The name is the exported one.
    IndirectExport = 1,
}

/// The 1-based line and column of the specifier that `name` names in the source of `importer_url`. The column counts
/// UTF-16 code units, as a stack frame's does. `None`: the path is not one that the module loader takes for JavaScript
/// or TypeScript, there is no source to read, it does not parse, or it has no such statement (the transpiler added the
/// import).
// What a removable-feature guard enters (`Bun__positionOfModuleLinkError`): the trimmable link expects a call there.
#[cold]
#[inline(never)]
pub fn position(
    vm: &mut VirtualMachine,
    importer_url: &bun_core::String,
    site: Site,
    name: &bun_core::String,
) -> Option<(u32, u32)> {
    let path = importer_url.to_utf8();
    let fs_path = bun_resolver::fs::Path::init(path.slice());
    let loader = match fs_path.loader(&vm.transpiler.options.loaders) {
        Some(loader) => loader,
        // The module loader takes a path that has no extension for TSX. `[eval]` and `[stdin]` are such paths.
        None if fs_path.name().ext.is_empty() => bun_ast::Loader::Tsx,
        None => return None,
    };
    if !loader.is_javascript_like() {
        return None;
    }

    let mut must_reset_parser_arena = false;
    let text = vm.original_source_text(vm.global(), importer_url, &mut must_reset_parser_arena);
    if must_reset_parser_arena {
        ModuleLoader::reset_arena(vm);
    }

    let source = bun_ast::Source::init_path_string(path.slice(), text.slice());
    let mut options = Options::init(Default::default(), loader);
    options.features.top_level_await = true;
    options.features.standard_decorators = !loader.is_typescript()
        || !(vm.transpiler.options.experimental_decorators
            || vm.transpiler.options.emit_decorator_metadata);
    let name = name.to_utf8();
    let loc = if loader.is_typescript() {
        parse_only_source::<true, _>(&source, options, |parsed| {
            specifier(parsed, site, name.slice())
        })
    } else {
        parse_only_source::<false, _>(&source, options, |parsed| {
            specifier(parsed, site, name.slice())
        })
    }??;

    let location = bun_ast::Location::init_or_null(Some(&source), bun_ast::Range { loc, len: 0 })?;
    Some((
        u32::try_from(location.line).ok()?,
        u32::try_from(location.column).ok()?,
    ))
}

/// Matches by name alone: the transpiler rewrites what a statement imports from (`fs` to `node:fs`).
fn specifier<const TYPESCRIPT: bool>(
    parsed: &ParsedOnly<'_, '_, TYPESCRIPT>,
    site: Site,
    name: &[u8],
) -> Option<Loc> {
    match site {
        Site::Import => import_specifier(parsed, name),
        Site::IndirectExport => parsed.stmts.iter().find_map(|stmt| match &stmt.data {
            StmtData::SExportFrom(export) => {
                let mut items = export.items.slice().iter();
                items
                    .find(|item| item.alias.slice() == name)
                    .map(|item| item.name.loc)
            }
            // An import that is exported: the import, as V8 reports it.
            StmtData::SExportClause(export) => {
                let mut items = export.items.slice().iter();
                let item = items.find(|item| item.alias.slice() == name)?;
                import_specifier(parsed, item.original_name.slice())
            }
            _ => None,
        }),
    }
}

fn import_specifier<const TYPESCRIPT: bool>(
    parsed: &ParsedOnly<'_, '_, TYPESCRIPT>,
    local: &[u8],
) -> Option<Loc> {
    parsed.stmts.iter().find_map(|stmt| {
        let StmtData::SImport(import) = &stmt.data else {
            return None;
        };
        if let Some(default_name) = import.default_name
            && parsed.name_of(default_name.ref_) == local
        {
            return Some(default_name.loc);
        }
        let mut items = import.items.slice().iter();
        items
            .find(|item| item.original_name.slice() == local)
            .map(|item| item.alias_loc)
    })
}
