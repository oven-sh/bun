use crate::import_resolve::{Resolved, Resolvers};
use crate::module_visitor::{self, Systems};
use bun_core::strings;
use bun_glob::scan::is_glob;
use bun_glob::{Options as GlobOptions, Pattern};
use bun_lint::context::interpolate_text;
use bun_lint::paths;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::SmallVec;
use std::sync::OnceLock;

/// Enforce which files can be imported in a given folder.
pub struct NoRestrictedPaths {
    zones: Vec<Written>,
    base_path: Option<Box<[u8]>>,
    /// With absolute paths. All files of a run have the same working directory.
    read: OnceLock<Vec<Zone>>,
}

/// A zone as the options have it.
struct Written {
    target: Vec<Box<[u8]>>,
    from: Vec<Box<[u8]>>,
    except: Vec<Box<[u8]>>,
    message: Box<str>,
}

const RESTRICTED: Message =
    Message::new("", "Unexpected path \"{{importPath}}\" imported in restricted zone.{{message}}");
const EXCEPTION_IS_NO_DESCENDANT: Message = Message::new(
    "",
    "Restricted path exceptions must be descendants of the configured `from` path for that zone.",
);
const FROM_IS_MIXED: Message =
    Message::new("", "Restricted path `from` must contain either only glob patterns or none");
const EXCEPTION_IS_NO_GLOB: Message =
    Message::new("", "Restricted path exceptions must be glob patterns when `from` contains glob patterns");

enum Place {
    Glob(Pattern),
    /// It, and all that is in it.
    Path(Vec<u8>),
}

/// The validators of a zone.
enum Validators {
    /// `computeMixedGlobAndAbsolutePathValidator`
    Mixed,
    /// `computeGlobPatternPathValidator`, for each. The exceptions are the same for all. `None`: one is no pattern.
    Globs(Vec<Pattern>, Option<Vec<Pattern>>),
    /// `computeAbsolutePathValidator`: each with its exceptions. `None`: one of them is not in it.
    Paths(Vec<(Vec<u8>, Option<Vec<Vec<u8>>>)>),
}

struct Zone {
    target: Vec<Place>,
    from: Validators,
    /// After a blank. It is a part of the message that ESLint fills in.
    message: Box<str>,
}

/// minimatch 3 trims the pattern.
fn minimatch(pattern: &[u8]) -> Pattern {
    Pattern::new(strings::trim_js_whitespace(pattern), GlobOptions::MINIMATCH)
}

/// `containsPath`. Both are absolute and resolved.
fn contains_path(filepath: &[u8], target: &[u8]) -> bool {
    match filepath.strip_prefix(target) {
        Some([]) => true,
        Some([b'/', rest @ ..]) => !rest.starts_with(b".."),
        // Only in a path of Windows, or in a root, can there be more to it.
        _ if target.len() > 1 && target.starts_with(b"/") && !target.starts_with(b"//") => false,
        _ => !paths::relative(target, filepath).starts_with(b".."),
    }
}

impl Place {
    /// `isMatchingTargetPath`
    fn has(&self, filename: &[u8]) -> bool {
        match self {
            Place::Glob(pattern) => pattern.matches(filename),
            Place::Path(target) => contains_path(filename, target),
        }
    }
}

impl Zone {
    /// `makePathValidators`
    fn new(written: &Written, base_path: &[u8]) -> Zone {
        let absolute = |it: &[u8]| paths::resolve(base_path, it);
        let globs = written.from.iter().filter(|it| is_glob(it)).count();
        let from = if globs == 0 {
            let with_exceptions = |from: &[u8]| {
                let from = absolute(from);
                let exceptions: Vec<Vec<u8>> = written.except.iter().map(|it| paths::resolve(&from, it)).collect();
                // `importType(..) !== 'parent'`
                let are_valid = exceptions.iter().all(|it| !paths::is_external(&paths::relative(&from, it)));
                (from, are_valid.then_some(exceptions))
            };
            Validators::Paths(written.from.iter().map(|it| with_exceptions(it)).collect())
        } else if globs == written.from.len() {
            let are_valid = written.except.iter().all(|it| is_glob(it));
            let exceptions = || written.except.iter().map(|it| minimatch(it)).collect::<Vec<Pattern>>();
            let from = written.from.iter().map(|it| minimatch(&absolute(it))).collect();
            Validators::Globs(from, are_valid.then(exceptions))
        } else {
            Validators::Mixed
        };
        let place = |it: &[u8]| match absolute(it) {
            target if is_glob(&target) => Place::Glob(minimatch(&target)),
            target => Place::Path(target),
        };
        Zone { target: written.target.iter().map(|it| place(it)).collect(), from, message: written.message.clone() }
    }

    /// What `checkForRestrictedImportPath` reports for the zone. `found`: the file that `import_path` means.
    fn check<'a>(&self, (import_path, found, cwd): (&[u8], &[u8], &[u8]), report: &dyn Fn(Message) -> Report<'a>) {
        let restricted = || {
            let message = interpolate_text(&self.message, |name| (name == "importPath").then_some(import_path));
            report(RESTRICTED).data("message", message);
        };
        match &self.from {
            Validators::Mixed => drop(report(FROM_IS_MIXED)),
            Validators::Globs(from, exceptions) => {
                let applicable = from.iter().filter(|it| it.matches(found));
                match exceptions {
                    None => applicable.for_each(|_| drop(report(EXCEPTION_IS_NO_GLOB))),
                    Some(exceptions) if exceptions.iter().any(|it| it.matches(found)) => {}
                    Some(_) => applicable.for_each(|_| restricted()),
                }
            }
            Validators::Paths(from) => {
                // `path.relative`
                let absolute = paths::resolve(cwd, found);
                let found = absolute.as_slice();
                let applicable = || from.iter().filter(|it| contains_path(found, &it.0));
                applicable().filter(|it| it.1.is_none()).for_each(|_| drop(report(EXCEPTION_IS_NO_DESCENDANT)));
                for exceptions in applicable().filter_map(|it| it.1.as_ref()) {
                    if !exceptions.iter().any(|it| contains_path(found, it)) {
                        restricted();
                    }
                }
            }
        }
    }
}

/// `[].concat(value)`, of strings.
fn strings_of(value: Option<&Json>) -> Vec<Box<[u8]>> {
    match value {
        Some(Json::Array(items)) => items.iter().filter_map(Json::as_str).map(Box::from).collect(),
        Some(value) => value.as_str().map(Box::from).into_iter().collect(),
        None => Vec::new(),
    }
}

impl Rule for NoRestrictedPaths {
    const META: Meta = Meta::plugin(Plugin::Import, "no-restricted-paths", Kind::Problem).needs_modules();
    const ON: On = On::new().finish();
    /// The zones that have the file as a target: where they are in [`NoRestrictedPaths::read`].
    type State<'a> = SmallVec<[u32; 8]>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let zone = |it: &Json| Written {
            target: strings_of(it.get(b"target")),
            from: strings_of(it.get(b"from")),
            except: strings_of(it.get(b"except")),
            message: match Object::of(Some(it)).str("message") {
                None | Some("") => Box::default(),
                Some(message) => [" ", message].concat().into(),
            },
        };
        NoRestrictedPaths {
            zones: options.array("zones").iter().map(zone).collect(),
            base_path: options.str("basePath").filter(|it| !it.is_empty()).map(|it| it.as_bytes().into()),
            read: OnceLock::new(),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        let modules = file.modules().filter(|_| file.path() != b"<text>")?;
        let zones = self.read.get_or_init(|| {
            let cwd = modules.cwd();
            let base_path = self.base_path.as_ref().map_or_else(|| cwd.to_vec(), |it| paths::resolve(cwd, it));
            self.zones.iter().map(|it| Zone::new(it, &base_path)).collect()
        });
        let filename = paths::portable(file.path(), file.path());
        let is_target = |zone: &Zone| zone.target.iter().any(|it| it.has(&filename));
        let matching: Self::State<'a> = (0u32..).zip(zones).filter(|it| is_target(it.1)).map(|it| it.0).collect();
        (!matching.is_empty()).then_some(matching)
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let file = cx.file();
        let Some(zones) = self.read.get() else {
            return;
        };
        let (Some(resolvers), Some(modules)) = (Resolvers::of(file.settings()), file.modules()) else {
            return;
        };
        let cwd = modules.cwd();
        let systems = Systems { esmodule: true, commonjs: true, amd: false };
        for visited in module_visitor::visit(file, systems) {
            let Resolved::File(found) = resolvers.resolve(file, visited.specifier, visited.is_require) else {
                continue;
            };
            let report = |message: Message| cx.report(visited.source, message).data("importPath", visited.specifier);
            for zone in cx.state.iter().filter_map(|it| zones.get(*it as usize)) {
                zone.check((visited.specifier, &found, cwd), &report);
            }
        }
    }
}
