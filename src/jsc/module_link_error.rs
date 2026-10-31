//! Finds the statement of a module link error in the source of its module, for `Bun__locateModuleLinkError`.

use bun_ast::stmt::Data as StmtData;
use bun_ast::{Loc, S};
use bun_js_parser::parse::parse_entry::{Options, ParsedOnly, parse_only_source_until};
use bun_resolver::fs::PathResolverExt as _;

use crate::module_loader::ModuleLoader;
use crate::virtual_machine::VirtualMachine;

/// A failed link parses no more of a module than this for the statement.
const SEARCH_LIMIT: usize = 1024 * 1024;

/// `JSC::ModuleLinkErrorSite`: which statement of the importing module, and what the name that comes with it names.
#[derive(Clone, Copy)]
enum Site {
    /// An import. The name is its local binding.
    Import,
    /// `export { x } from`, or an import that is exported. The name is the exported one.
    IndirectExport,
}

impl Site {
    /// `None`: a site that JavaScriptCore has and this code does not know.
    fn from_raw(site: u8) -> Option<Site> {
        match site {
            0 => Some(Site::Import),
            1 => Some(Site::IndirectExport),
            _ => None,
        }
    }
}

/// The 1-based line and UTF-16 column of the specifier that `name` names in the source of `importer_url`.
// A removable-feature guard enters here (`Bun__positionOfModuleLinkError`): the trimmable link expects a call.
#[cold]
#[inline(never)]
pub fn position(
    vm: &mut VirtualMachine,
    importer_url: &bun_core::String,
    site: u8,
    name: &bun_core::String,
) -> Option<(u32, u32)> {
    let site = Site::from_raw(site)?;
    let path = importer_url.to_utf8();
    // The static code of an executable is what the executable holds, not the file on disk.
    if !VirtualMachine::is_file_on_disk_static(vm.standalone_module_graph.is_some(), path.slice()) {
        return None;
    }
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

    let searched = &text.slice()[..text.slice().len().min(SEARCH_LIMIT)];
    let source = bun_ast::Source::init_path_string(path.slice(), searched);
    let is_prefix = searched.len() < text.slice().len();
    let mut options = Options::init(Default::default(), loader);
    options.features.top_level_await = true;
    options.features.dont_bundle_twice = true;
    options.features.standard_decorators = !loader.is_typescript()
        || !(vm.transpiler.options.experimental_decorators
            || vm.transpiler.options.emit_decorator_metadata);
    let name = name.to_utf8();
    let mut search = Search {
        site,
        name: name.slice(),
        imported: Vec::new(),
        exported_local: None,
    };
    let loc = if loader.is_typescript() {
        parse_only_source_until::<true, _>(&source, options, is_prefix, |parsed| {
            search.next(parsed)
        })
    } else {
        parse_only_source_until::<false, _>(&source, options, is_prefix, |parsed| {
            search.next(parsed)
        })
    }?;

    let location = bun_ast::Location::init_or_null(Some(&source), bun_ast::Range { loc, len: 0 })?;
    Some((
        u32::try_from(location.line).ok()?,
        u32::try_from(location.column).ok()?,
    ))
}

/// Matches by name alone: the transpiler rewrites what a statement imports from (`fs` to `node:fs`).
struct Search<'a> {
    site: Site,
    name: &'a [u8],
    /// What the imports so far bind: an import that is exported is reported at the import, as V8 reports it.
    imported: Vec<(Box<[u8]>, Loc)>,
    /// The local name that an export clause exports as `name`, for the import under the clause that binds it.
    exported_local: Option<Box<[u8]>>,
}

impl Search<'_> {
    /// Where the specifier is, once the statement in `parsed` settles that.
    fn next<const TYPESCRIPT: bool>(
        &mut self,
        parsed: &ParsedOnly<'_, '_, TYPESCRIPT>,
    ) -> Option<Loc> {
        let stmt = parsed.stmts.first()?;
        match (self.site, &stmt.data) {
            (Site::Import, StmtData::SImport(import)) => {
                binding(bindings(parsed, import), self.name)
            }
            (Site::IndirectExport, StmtData::SImport(import)) => match &self.exported_local {
                Some(local) => binding(bindings(parsed, import), local),
                None => {
                    let bound = bindings(parsed, import).map(|(local, loc)| (local.into(), loc));
                    self.imported.extend(bound);
                    None
                }
            },
            (Site::IndirectExport, StmtData::SExportFrom(export)) => {
                let mut items = export.items.slice().iter();
                items
                    .find(|item| item.alias.slice() == self.name)
                    .map(|item| item.name.loc)
            }
            (Site::IndirectExport, StmtData::SExportClause(export)) => {
                let mut items = export.items.slice().iter();
                let local = items
                    .find(|item| item.alias.slice() == self.name)?
                    .original_name
                    .slice();
                let imported = self.imported.iter().map(|(name, loc)| (&**name, *loc));
                let above = binding(imported, local);
                if above.is_none() {
                    self.exported_local = Some(local.into());
                }
                above
            }
            _ => None,
        }
    }
}

/// Each name that `import` binds and a link checks, with where the name that it imports is.
fn bindings<'p, const TYPESCRIPT: bool>(
    parsed: &'p ParsedOnly<'_, '_, TYPESCRIPT>,
    import: &'p S::Import,
) -> impl Iterator<Item = (&'p [u8], Loc)> {
    let default = import
        .default_name
        .map(|name| (parsed.name_of(name.ref_), name.loc));
    let named = import.items.slice().iter();
    default
        .into_iter()
        .chain(named.map(|item| (item.original_name.slice(), item.alias_loc)))
}

fn binding<'p>(mut bindings: impl Iterator<Item = (&'p [u8], Loc)>, local: &[u8]) -> Option<Loc> {
    bindings
        .find(|(name, _)| *name == local)
        .map(|(_, loc)| loc)
}
