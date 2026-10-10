use crate::import_type::ImportType::{External, Index, Internal, Parent, Sibling};
use crate::import_type::ImportTypes;
use crate::module_visitor::{Systems, Visitor};
use bun_core::strings;
use bun_glob::{Options as GlobOptions, Pattern};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::SmallVec;
use std::borrow::Cow;

/// Forbid importing the submodules of other modules.
pub struct NoInternalModules {
    visitor: Visitor,
    /// `forbidRegexps` if there is a `forbid`, else `allowRegexps`.
    regexps: Vec<Pattern>,
    is_forbid: bool,
}

const REACHING: Message = Message::new("", "Reaching to \"{{importPath}}\" is not allowed.");

/// `normalizeSep`
fn normalize_sep(some_path: &[u8]) -> Cow<'_, [u8]> {
    match strings::contains_char(some_path, b'\\') {
        true => Cow::Owned(strings::replace_owned(some_path, b"\\", b"/")),
        false => Cow::Borrowed(some_path),
    }
}

/// `toSteps`
fn to_steps(some_path: &[u8]) -> SmallVec<[&[u8]; 8]> {
    let mut steps = SmallVec::new();
    for step in strings::tokenize_any(some_path, b"/\\") {
        match step {
            b"." => {}
            b".." => {
                steps.pop();
            }
            step => steps.push(step),
        }
    }
    steps
}

impl NoInternalModules {
    /// `reachingAllowed`, `reachingForbidden`
    fn is_listed(&self, import_path: &[u8]) -> bool {
        self.regexps.iter().any(|re| re.matches(import_path))
    }
}

impl Rule for NoInternalModules {
    const META: Meta = Meta::plugin(Plugin::Import, "no-internal-modules", Kind::Suggestion).needs_modules();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let is_forbid = options.has("forbid");
        let globs = options.array(if is_forbid { "forbid" } else { "allow" }).iter().filter_map(Json::as_str);
        NoInternalModules {
            visitor: Visitor::of(Systems { esmodule: true, commonjs: true, amd: false }),
            regexps: globs.map(|it| Pattern::new(it, GlobOptions::MINIMATCH_3_MAKE_RE)).collect(),
            is_forbid,
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        let can_report = !self.is_forbid || !self.regexps.is_empty();
        (can_report && self.visitor.may_visit(file)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let file = cx.file();
        let Some(types) = ImportTypes::of(file) else {
            return;
        };
        for visited in self.visitor.visit(file) {
            let import_path = visited.specifier;
            let steps = to_steps(import_path);
            if !self.is_forbid && steps.iter().filter(|step| !step.starts_with(b"@")).count() <= 1 {
                continue;
            }
            let is_listed = !self.regexps.is_empty() && {
                let just_steps = steps.join(&b'/');
                self.is_listed(&just_steps) || self.is_listed(&[b"/", &just_steps[..]].concat())
            };
            let import_type = if is_listed {
                if !self.is_forbid {
                    continue;
                }
                types.of_name(import_path, visited.is_require)
            } else {
                let resolved = types.resolvers().resolve(file, import_path, visited.is_require);
                // What is not found is neither allowed nor forbidden by its path, and is not reported.
                if resolved.file().is_none_or(|it| self.is_listed(&normalize_sep(it)) != self.is_forbid) {
                    continue;
                }
                types.of_resolved(import_path, &resolved)
            };
            // `potentialViolationTypes`
            if matches!(import_type, Parent | Index | Sibling | External | Internal) {
                cx.report(visited.source, REACHING).data("importPath", import_path);
            }
        }
    }
}
