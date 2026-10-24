//! Finds the imports that Bun loads as an HTML page: by the `type` attribute, or else by the loader of the extension.

use bun_ast::{Loader, LoaderHashTable};
use bun_paths::fs::PathName;
use bun_paths::platform::Posix;
use bun_paths::resolve_path::dirname;
use bun_sema::atom::Atom;
use bun_sema::hir::{self, ExprId, ExprKind, SpecifierKind, skip_assertions};
use bun_sema::program::{FileId, Files};
use bun_sema::resolve::{Host, is_relative, join};
use bun_sema::util::SharedSort;

/// Finds the pages that the files of one program import.
pub(crate) struct Pages<'a, 's> {
    host: &'a dyn Host,
    files: &'a Files<'s>,
    /// `Request::loaders`
    loaders: &'a LoaderHashTable,
    /// `loaders` gives the HTML loader to an extension that is not `.html`.
    has_other_page_extensions: bool,
}

/// A specifier of one file that can name a page, and what its uses in the file say.
struct Import {
    specifier: Atom,
    /// The extension that is written in the specifier is a page's.
    has_page_extension: bool,
    /// A use names the HTML loader.
    names_html: bool,
    /// A use names no loader, so Bun takes the loader of the file's extension.
    names_nothing: bool,
}

/// The `with` clauses and the `import()` options of one file, by the position of their specifier. Made on first use.
#[derive(Default)]
struct Attributes {
    /// Each `import` declaration, from its first token to its end. Sorted.
    declarations: Option<Vec<(u32, u32)>>,
    /// The second argument of each `import()` that has one, by the position of the first. Sorted.
    options: Option<Vec<(u32, ExprId)>>,
}

impl<'a, 's> Pages<'a, 's> {
    pub(crate) fn new(
        host: &'a dyn Host,
        files: &'a Files<'s>,
        loaders: &'a LoaderHashTable,
    ) -> Self {
        let mut of_pages = loaders.iter().filter(|it| *it.1 == Loader::Html);
        Pages {
            host,
            files,
            loaders,
            has_other_page_extensions: of_pages.any(|it| !it.0.eq_ignore_ascii_case(b".html")),
        }
    }

    /// The paths of the pages that `file` imports, in the order of the imports.
    pub(crate) fn imported_by(&self, file: FileId) -> Vec<Vec<u8>> {
        let module = self.files.module(file);
        let hir = &module.hir;
        let mut attributes = Attributes::default();
        // Without a `type` that names the HTML loader somewhere in the file, only the extension makes a page.
        let mut clauses = hir.import_attributes.iter();
        let mut uses = hir.specifier_uses.iter();
        let can_name_html = clauses.any(|it| self.loader_named_in(hir, it.1) == Some(Loader::Html))
            || (uses.any(|it| it.kind == SpecifierKind::ImportCall)
                && !attributes.options(hir).is_empty());
        let mut imports = Vec::new();
        for &specifier in module.bound.specifiers.iter() {
            let written = self.files.atoms.bytes(specifier);
            let has_page_extension = self.has_page_extension(written);
            // Where a specifier that is no path leads is for Bun's resolver to say.
            if (has_page_extension || can_name_html) && is_relative(written) {
                imports.push(Import {
                    specifier,
                    has_page_extension,
                    names_html: false,
                    names_nothing: false,
                });
            }
        }
        if imports.is_empty() {
            return Vec::new();
        }
        self.read_attributes(hir, &mut attributes, &mut imports);
        let directory = dirname::<Posix>(module.file_name());
        let is_page = |it: &&Import| it.names_html || (it.names_nothing && it.has_page_extension);
        let pages = imports.iter().filter(is_page);
        let pages = pages.map(|it| join(directory, self.files.atoms.bytes(it.specifier)));
        // Anything else is not read: a named pipe would block.
        pages.filter(|page| self.host.is_file(page)).collect()
    }

    /// True if `path` has the extension of a page. Read as `Path::loader` reads it: a file named `.html` has one.
    fn has_page_extension(&self, path: &[u8]) -> bool {
        // Nearly every specifier ends otherwise, which a byte or two show.
        let end = path.len().checked_sub(5).map(|start| &path[start..]);
        let ends_in_html = end.is_some_and(|end| end.eq_ignore_ascii_case(b".html"));
        (ends_in_html || self.has_other_page_extensions)
            && Loader::of_extension(PathName::init(path).ext, self.loaders) == Some(Loader::Html)
    }

    /// Reads the `type` attribute of every use of `imports` in the file, in one pass over its specifiers.
    fn read_attributes(
        &self,
        hir: &hir::File<'s>,
        attributes: &mut Attributes,
        imports: &mut [Import],
    ) {
        // Only to find an import by its specifier: the numbers of atoms differ from run to run.
        let mut by_atom: Vec<usize> = (0..imports.len()).collect();
        by_atom.shared_sort_unstable_by_key(|&at| imports[at].specifier.0);
        for specifier_use in hir.specifier_uses.iter() {
            let atom = specifier_use.spec.0;
            let Ok(found) = by_atom.binary_search_by_key(&atom, |&at| imports[at].specifier.0)
            else {
                continue;
            };
            // Bun reads attributes after `import .. from` and in the options of `import()`, not after `export .. from`.
            let clause = match specifier_use.kind {
                SpecifierKind::Import | SpecifierKind::SideEffect => {
                    attributes.of_declaration(hir, specifier_use.pos)
                }
                SpecifierKind::ImportCall => attributes
                    .of_import_call(hir, specifier_use.pos)
                    .and_then(|options| self.with_in(hir, options)),
                _ => None,
            };
            let import = &mut imports[by_atom[found]];
            match clause.and_then(|it| self.loader_named_in(hir, it)) {
                Some(Loader::Html) => import.names_html = true,
                Some(_) => {}
                None => import.names_nothing = true,
            }
        }
    }

    /// The value of `with` in the options of an `import()`, if the call has them written: the runtime evaluates them.
    fn with_in(&self, hir: &hir::File<'s>, options: ExprId) -> Option<ExprId> {
        let ExprKind::Object(options) = hir[skip_assertions(hir, options)].kind else {
            return None;
        };
        let mut options = options.iter().map(|it| hir[it]);
        let with = options.find(|it| self.is_named(it.key, b"with"))?;
        Some(with.value)
    }

    /// The loader that `type` names in `clause`, the object after `with`. A name that no loader has is ignored.
    fn loader_named_in(&self, hir: &hir::File<'s>, clause: ExprId) -> Option<Loader> {
        let ExprKind::Object(attributes) = hir[skip_assertions(hir, clause)].kind else {
            return None;
        };
        let attributes = attributes.iter().rev().map(|it| hir[it]);
        let mut types = attributes.filter(|it| self.is_named(it.key, b"type"));
        types.find_map(|it| match hir[skip_assertions(hir, it.value)].kind {
            ExprKind::String(name) => Loader::from_string(self.files.atoms.bytes(name)),
            _ => None,
        })
    }

    fn is_named(&self, key: hir::PropKey, name: &[u8]) -> bool {
        matches!(key, hir::PropKey::Name(key) if self.files.atoms.bytes(key) == name)
    }
}

impl Attributes {
    /// The `with` clause of the `import` declaration whose specifier is at `specifier`.
    fn of_declaration(&mut self, hir: &hir::File, specifier: u32) -> Option<ExprId> {
        let clauses = &hir.import_attributes[..];
        if clauses.is_empty() {
            return None;
        }
        let declarations = self.declarations.get_or_insert_with(|| {
            let declarations = hir.imports.iter().filter(|it| it.stmt.is_some());
            let mut ranges: Vec<(u32, u32)> = declarations
                .map(|it| (hir[it.stmt].start, hir[it.stmt].loc.end))
                .collect();
            ranges.shared_sort_unstable_by_key(|it| it.0);
            ranges
        });
        let before = declarations.partition_point(|it| it.0 <= specifier);
        let &(_, end) = declarations[..before]
            .last()
            .filter(|it| specifier < it.1)?;
        let clause = clauses.get(clauses.partition_point(|it| it.0 <= specifier))?;
        (clause.0 < end).then_some(clause.1)
    }

    fn options(&mut self, hir: &hir::File) -> &[(u32, ExprId)] {
        self.options.get_or_insert_with(|| {
            let calls = hir.exprs.iter().filter_map(|it| match it.kind {
                ExprKind::ImportCall { args, .. } => {
                    let mut args = hir.ids::<ExprId>(args);
                    Some((hir[args.next()?].pos, args.next()?))
                }
                _ => None,
            });
            let mut options: Vec<(u32, ExprId)> = calls.collect();
            options.shared_sort_unstable_by_key(|it| it.0);
            options
        })
    }

    /// The second argument of the `import()` whose first argument is at `specifier`.
    fn of_import_call(&mut self, hir: &hir::File, specifier: u32) -> Option<ExprId> {
        let options = self.options(hir);
        let at = options.binary_search_by_key(&specifier, |it| it.0).ok()?;
        Some(options[at].1)
    }
}
