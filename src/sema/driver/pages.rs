//! Finds the imports that Bun loads as an HTML page: by the `type` attribute, or else by the loader of the extension.

use crate::PageRules;
use bun_ast::Loader;
use bun_paths::fs::PathName;
use bun_paths::platform::Posix;
use bun_paths::resolve_path::dirname;
use bun_sema::atom::Atom;
use bun_sema::hir::{self, ExprId, ExprKind, SpecifierKind, SpecifierUse, skip_assertions};
use bun_sema::program::{FileId, Files};
use bun_sema::resolve::{Host, is_relative, is_same_path, join};
use bun_sema::util::SharedSort;

/// Finds the pages that the files of one program import.
pub(crate) struct Pages<'a, 's> {
    host: &'a dyn Host,
    files: &'a Files<'s>,
    rules: PageRules<'a>,
    /// `PageRules::loaders` gives the HTML loader to an extension that is not `.html`.
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

/// An `import` or an `export .. from` declaration.
struct Declaration {
    /// Its first token.
    start: u32,
    end: u32,
    is_import: bool,
    /// Bun's parser drops the declaration: `import type`, or every name in its braces has `type`.
    has_only_types: bool,
}

/// The declarations and the `import()` options of one file, by the position of their specifier. Made on first use.
#[derive(Default)]
struct Attributes {
    /// Sorted.
    declarations: Option<Vec<Declaration>>,
    /// The second argument of each `import()` that has one, by the position of the first. Sorted.
    options: Option<Vec<(u32, ExprId)>>,
}

impl<'a, 's> Pages<'a, 's> {
    pub(crate) fn new(host: &'a dyn Host, files: &'a Files<'s>, rules: PageRules<'a>) -> Self {
        let mut of_pages = rules.loaders.iter().filter(|it| *it.1 == Loader::Html);
        Pages {
            host,
            files,
            rules,
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
        let names_html =
            |clause| self.loader_named_in(hir, clause, usize::MAX) == Some(Loader::Html);
        let can_name_html = clauses.any(|it| names_html(it.1))
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
        let pages = pages.filter(|page| self.host.is_file(page));
        pages
            .filter(|page| !self.is_loaded_otherwise(page))
            .collect()
    }

    /// True if `path` has the extension of a page. Read as `Path::loader` reads it: a file named `.html` has one.
    fn has_page_extension(&self, path: &[u8]) -> bool {
        // Nearly every specifier ends otherwise, which a byte or two show.
        let end = path.len().checked_sub(5).map(|start| &path[start..]);
        let ends_in_html = end.is_some_and(|end| end.eq_ignore_ascii_case(b".html"));
        let loader = |extension| Loader::of_extension(extension, self.rules.loaders);
        (ends_in_html || self.has_other_page_extensions)
            && loader(PathName::init(path).ext) == Some(Loader::Html)
    }

    /// `PageRules::not_pages` has `page`.
    fn is_loaded_otherwise(&self, page: &[u8]) -> bool {
        let mut not_pages = self.rules.not_pages.iter();
        not_pages.any(|it| is_same_path(it, page, self.host.is_case_sensitive()))
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
            let import = &mut imports[by_atom[found]];
            match self.loader_named_by(hir, attributes, specifier_use) {
                Some(Some(Loader::Html)) => import.names_html = true,
                Some(Some(_)) => {}
                Some(None) => import.names_nothing = true,
                None => {}
            }
        }
    }

    /// The loader that a use of a specifier names, if any. `None`: the use names only types, so Bun loads nothing.
    fn loader_named_by(
        &self,
        hir: &hir::File<'s>,
        attributes: &mut Attributes,
        specifier_use: &SpecifierUse,
    ) -> Option<Option<Loader>> {
        let (clause, types_read) = match specifier_use.kind {
            SpecifierKind::ImportType => return None,
            // Bun's parser takes the last `type` that names a loader.
            SpecifierKind::Import | SpecifierKind::SideEffect => (
                attributes.of_declaration(hir, specifier_use.pos)?,
                usize::MAX,
            ),
            // The runtime evaluates the options, which leaves the last `type`.
            SpecifierKind::ImportCall => {
                let options = attributes.of_import_call(hir, specifier_use.pos);
                (options.and_then(|it| self.with_in(hir, it)), 1)
            }
            _ => (None, 0),
        };
        Some(clause.and_then(|it| self.loader_named_in(hir, it, types_read)))
    }

    /// The value of `with` in the options of an `import()`, if the call has them written.
    fn with_in(&self, hir: &hir::File<'s>, options: ExprId) -> Option<ExprId> {
        let ExprKind::Object(options) = hir[skip_assertions(hir, options)].kind else {
            return None;
        };
        let mut options = options.iter().rev().map(|it| hir[it]);
        let with = options.find(|it| self.is_named(it.key, b"with"))?;
        Some(with.value)
    }

    /// The loader that one of the last `types_read` `type`s of `clause` names. `clause` is the object after `with`.
    fn loader_named_in(
        &self,
        hir: &hir::File<'s>,
        clause: ExprId,
        types_read: usize,
    ) -> Option<Loader> {
        let ExprKind::Object(attributes) = hir[skip_assertions(hir, clause)].kind else {
            return None;
        };
        let attributes = attributes.iter().rev().map(|it| hir[it]);
        let types = attributes.filter(|it| self.is_named(it.key, b"type"));
        types.take(types_read).find_map(|it| {
            let name = match hir[skip_assertions(hir, it.value)].kind {
                ExprKind::String(name) => name,
                ExprKind::Template { exprs } if exprs.is_empty() => {
                    hir.id_at(hir.template_texts(exprs), 0)
                }
                _ => return None,
            };
            Loader::from_string(self.files.atoms.bytes(name))
        })
    }

    fn is_named(&self, key: hir::PropKey, name: &[u8]) -> bool {
        matches!(key, hir::PropKey::Name(key) if self.files.atoms.bytes(key) == name)
    }
}

impl Attributes {
    /// The `with` clause that Bun reads for the declaration with its specifier at `specifier`. `None`: only types.
    fn of_declaration(&mut self, hir: &hir::File, specifier: u32) -> Option<Option<ExprId>> {
        let declarations = self
            .declarations
            .get_or_insert_with(|| declarations_of(hir));
        let before = declarations.partition_point(|it| it.start <= specifier);
        let Some(found) = declarations[..before]
            .last()
            .filter(|it| specifier < it.end)
        else {
            // `export * from`. The specifier of a JSDoc `@import` is in a comment, and it names types.
            return (!is_in_comment(hir, specifier)).then_some(None);
        };
        if found.has_only_types {
            return None;
        }
        let clauses = &hir.import_attributes[..];
        let clause = clauses.get(clauses.partition_point(|it| it.0 <= specifier));
        // Bun reads no attributes after `export .. from`.
        let clause = clause.filter(|it| found.is_import && it.0 < found.end);
        Some(clause.map(|it| it.1))
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

/// The `import` and the `export .. from` declarations of a file, in the order of the text.
fn declarations_of(hir: &hir::File) -> Vec<Declaration> {
    let imports = hir.imports.iter().filter(|it| it.stmt.is_some());
    let imports = imports.map(|it| {
        let has_only_names = it.default.is_none() && it.namespace.is_none() && !it.named.is_empty();
        let mut names = it.named.iter();
        Declaration {
            start: hir[it.stmt].start,
            end: hir[it.stmt].loc.end,
            is_import: true,
            has_only_types: it.type_only
                || (has_only_names && names.all(|name| hir[name].type_only)),
        }
    });
    let exports = hir.exports.iter();
    let exports = exports.filter(|it| it.has_module_specifier && it.stmt.is_some());
    let exports = exports.map(|it| {
        let mut names = it.items.iter();
        Declaration {
            start: hir[it.stmt].start,
            end: hir[it.stmt].loc.end,
            is_import: false,
            has_only_types: it.type_only
                || (!it.items.is_empty() && names.all(|name| hir[name].type_only)),
        }
    });
    let mut declarations: Vec<Declaration> = imports.chain(exports).collect();
    declarations.shared_sort_unstable_by_key(|it| it.start);
    declarations
}

/// True if `pos` is in a comment.
fn is_in_comment(hir: &hir::File, pos: u32) -> bool {
    let before = hir.comments.partition_point(|it| it.pos <= pos);
    hir.comments[..before].last().is_some_and(|it| pos < it.end)
}
