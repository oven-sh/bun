use crate::import_resolve::Resolvers;
use crate::import_settings::Settings;
use crate::module_visitor::{Visited, Visitor};
use bun_core::printer::json_stringify_alloc;
use bun_core::strings;
use bun_lint::paths;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use std::cell::OnceCell;

/// Forbid unnecessary path segments in import and require statements.
pub struct NoUselessPathSegments {
    visitor: Visitor,
    no_useless_index: bool,
}

const USELESS: Message =
    Message::new("", "Useless path segments for \"{{importPath}}\", should be \"{{proposedPath}}\"");

/// `toRelativePath`
fn to_relative_path(mut relative_path: Vec<u8>) -> Vec<u8> {
    if relative_path.ends_with(b"/") {
        relative_path.pop();
    }
    let after_dots = relative_path.strip_prefix(b"..").or_else(|| relative_path.strip_prefix(b"."));
    if matches!(after_dots, Some([] | [b'/', ..])) {
        return relative_path;
    }
    [&b"./"[..], &relative_path[..]].concat()
}

/// `countRelativeParents`, of a path that is not split yet.
fn count_relative_parents(path_segments: &[u8]) -> usize {
    strings::split(path_segments, b"/").filter(|it| *it == b"..").count()
}

/// What `checkSourceValue` closes over.
struct Context<'a> {
    file: &'a File<'a>,
    cwd: &'a [u8],
    resolvers: Resolvers<'a>,
    settings: Settings<'a>,
    no_useless_index: bool,
    /// `None`: `new RegExp` throws.
    regex_unnecessary_index: OnceCell<Option<Regex>>,
}

impl Context<'_> {
    /// `regexUnnecessaryIndex.test(importPath)`
    fn is_unnecessary_index(&self, import_path: &[u8]) -> bool {
        if !strings::contains(import_path, b"/index") {
            return false;
        }
        let regex = self.regex_unnecessary_index.get_or_init(|| {
            let file_extensions = self.settings.file_extensions().join(&b"|\\"[..]);
            Regex::from_bytes(&[&b".*\\/index(\\"[..], &file_extensions[..], b")?$"].concat(), b"").ok()
        });
        regex.as_ref().is_some_and(|it| it.test(import_path))
    }

    /// `checkSourceValue`: what it calls `reportWithProposedPath` with.
    fn check_source_value(&self, source: &Visited<'_>) -> Option<Vec<u8>> {
        let import_path = source.specifier;
        let resolve = |path: &[u8]| self.resolvers.resolve(self.file, path, source.is_require);

        let mut resolved_path = None;
        // `normalize`
        let normed_path = to_relative_path(paths::normalize(import_path));
        if normed_path != import_path {
            let (resolved, resolved_normed) = (resolve(import_path), resolve(&normed_path));
            // `undefined`, `null` and a path are three.
            if (resolved.is_found(), resolved.file()) == (resolved_normed.is_found(), resolved_normed.file()) {
                return Some(normed_path);
            }
            resolved_path = Some(resolved);
        }

        if self.no_useless_index && self.is_unnecessary_index(import_path) {
            let parent_directory = paths::dirname(import_path);
            let is_file = |extension: &[u8]| resolve(&[parent_directory, extension].concat()).file().is_some();
            // "Try to find ambiguous imports"
            if !matches!(parent_directory, b"." | b"..") && self.settings.file_extensions().into_iter().any(is_file) {
                return Some([parent_directory, b"/"].concat());
            }
            return Some(parent_directory.to_vec());
        }

        if import_path.starts_with(b"./") {
            return None;
        }
        let resolved_path = resolved_path.unwrap_or_else(|| resolve(import_path));
        let resolved_path = paths::resolve(self.cwd, resolved_path.file()?);
        let filename = paths::portable(self.file.path(), self.file.path());
        let current_dir = paths::resolve(self.cwd, paths::dirname(&filename));
        let count_import_path = count_relative_parents(import_path);
        let count_expected = count_relative_parents(&paths::relative(&current_dir, &resolved_path));
        let diff = count_import_path.checked_sub(count_expected).filter(|it| *it > 0)?;

        let import_path_split = || strings::split(import_path, b"/");
        let kept = import_path_split().take(count_expected).chain(import_path_split().skip(count_import_path + diff));
        Some(to_relative_path(kept.collect::<Vec<&[u8]>>().join(&b'/')))
    }
}

impl Rule for NoUselessPathSegments {
    const META: Meta = Meta::plugin(Plugin::Import, "no-useless-path-segments", Kind::Suggestion)
        .fixable(Fixable::Code)
        .needs_modules();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoUselessPathSegments {
            visitor: Visitor::new(options),
            no_useless_index: options.bool_or("noUselessIndex", false),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.modules().is_some() && self.visitor.may_visit(file)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let file = cx.file();
        let mut sources = self.visitor.visit(file);
        sources.retain(|it| it.specifier.starts_with(b"."));
        if sources.is_empty() {
            return;
        }
        let (Some(resolvers), Some(modules)) = (Resolvers::of(file.settings()), file.modules()) else {
            return;
        };
        let context = Context {
            file,
            cwd: modules.cwd(),
            resolvers,
            settings: Settings::new(file.settings()),
            no_useless_index: self.no_useless_index,
            regex_unnecessary_index: OnceCell::new(),
        };
        for source in &sources {
            let Some(proposed_path) = context.check_source_value(source) else {
                continue;
            };
            cx.report(source.source, USELESS)
                .data("importPath", source.specifier)
                .fix(|fixer| fixer.replace(source.source, json_stringify_alloc(&proposed_path)))
                .data("proposedPath", proposed_path);
        }
    }
}
