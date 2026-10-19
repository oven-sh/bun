use crate::import_minimatch::Glob;
use crate::import_resolve::{Resolved, Resolvers};
use crate::module_visitor::{self, Systems};
use bun_glob::scan::is_glob;
use bun_lint::context::interpolate_text;
use bun_lint::paths;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::SmallVec;
use std::sync::OnceLock;

/// Enforce which files can be imported in a given folder.
pub struct NoRestrictedPaths {
    zones: Vec<ZoneOptions>,
    base_path: Option<Box<[u8]>>,
    /// The zones with absolute paths. Every file in a run has the same working directory.
    read: OnceLock<Vec<Zone>>,
}

/// A zone as it appears in the options.
struct ZoneOptions {
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

enum Target {
    Glob(Glob),
    /// The path itself and everything under it.
    Path(Vec<u8>),
}

/// A zone's validators.
enum Validators {
    /// `computeMixedGlobAndAbsolutePathValidator`
    Mixed,
    /// `computeGlobPatternPathValidator` for each glob. They all share the exceptions, which are `None` if one of them
    /// isn't a glob.
    Globs(Vec<Glob>, Option<Vec<Glob>>),
    /// `computeAbsolutePathValidator`: each path with its exceptions, which are `None` if one of them isn't under the
    /// path.
    Paths(Vec<(Vec<u8>, Option<Vec<Vec<u8>>>)>),
}

struct Zone {
    target: Vec<Target>,
    from: Validators,
    /// Starts with a space. ESLint interpolates it as part of the message.
    message: Box<str>,
}

/// `containsPath`. Both are absolute and resolved.
fn contains_path(filepath: &[u8], target: &[u8]) -> bool {
    match filepath.strip_prefix(target) {
        Some([]) => true,
        Some([b'/', rest @ ..]) => !rest.starts_with(b".."),
        // Only a Windows path or a root can need the full comparison.
        _ if target.len() > 1 && target.starts_with(b"/") && !target.starts_with(b"//") => false,
        _ => !paths::relative(target, filepath).starts_with(b".."),
    }
}

impl Target {
    /// `isMatchingTargetPath`
    fn has(&self, filename: &[u8]) -> bool {
        match self {
            Target::Glob(pattern) => pattern.matches(filename),
            Target::Path(target) => contains_path(filename, target),
        }
    }
}

impl Zone {
    /// `makePathValidators`
    fn new(zone_options: &ZoneOptions, base_path: &[u8]) -> Zone {
        let absolute = |it: &[u8]| paths::resolve(base_path, it);
        let globs = zone_options.from.iter().filter(|it| is_glob(it)).count();
        let from = if globs == 0 {
            let with_exceptions = |from: &[u8]| {
                let from = absolute(from);
                let exceptions: Vec<Vec<u8>> = zone_options.except.iter().map(|it| paths::resolve(&from, it)).collect();
                // `importType(..) !== 'parent'`
                let are_valid = exceptions.iter().all(|it| !paths::is_external(&paths::relative(&from, it)));
                (from, are_valid.then_some(exceptions))
            };
            Validators::Paths(zone_options.from.iter().map(|it| with_exceptions(it)).collect())
        } else if globs == zone_options.from.len() {
            let are_valid = zone_options.except.iter().all(|it| is_glob(it));
            let exceptions = || zone_options.except.iter().map(|it| Glob::new(it)).collect::<Vec<Glob>>();
            let from = zone_options.from.iter().map(|it| Glob::new(&absolute(it))).collect();
            Validators::Globs(from, are_valid.then(exceptions))
        } else {
            Validators::Mixed
        };
        let to_target = |it: &[u8]| match absolute(it) {
            target if is_glob(&target) => Target::Glob(Glob::new(&target)),
            target => Target::Path(target),
        };
        Zone { target: zone_options.target.iter().map(|it| to_target(it)).collect(), from, message: zone_options.message.clone() }
    }

    /// Reports what `checkForRestrictedImportPath` reports for the zone. `found`: the file that `import_path` resolves
    /// to.
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

/// `[].concat(value)`, keeping only the strings.
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
    /// The indices in [`NoRestrictedPaths::read`] of the zones that target this file.
    type State<'a> = SmallVec<[u32; 8]>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let zone = |it: &Json| ZoneOptions {
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
