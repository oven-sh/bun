use crate::import_minimatch::GlobsFromCwd;
use crate::import_package_path::{file_package_name, pkg_up};
use crate::import_type::{ImportType, ImportTypes};
use crate::module_visitor::{Systems, Visitor};
use bun_core::strings;
use bun_lint::linter::json_parse;
use bun_lint::modules::Modules;
use bun_lint::paths;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashMap;
use std::borrow::Cow;
use std::sync::OnceLock;

/// Forbid the use of extraneous packages.
pub struct NoExtraneousDependencies {
    /// `devDependencies`, `optionalDependencies`, `peerDependencies`, `bundledDependencies`: each with its field.
    configs: [(Config, u8); 4],
    /// `None`: the closest `package.json` counts.
    package_dir: Option<Vec<Box<[u8]>>>,
    include_internal: bool,
    include_types: bool,
    visitor: Visitor,
    /// `getDependencies` with `packageDir`. All files of a run have the same working directory.
    in_package_dir: OnceLock<(DepFields, Option<Failure>)>,
    /// `depFieldCache`, by the path of the `package.json`, for as many as there is room.
    closest: [OnceLock<(Box<[u8]>, DepFields)>; 32],
}

const MISSING: Message = Message::new(
    "",
    "'{{packageName}}' should be listed in the project's dependencies. Run 'npm i -S {{packageName}}' to add it",
);
const DEV_DEP: Message =
    Message::new("", "'{{packageName}}' should be listed in the project's dependencies, not devDependencies.");
const OPT_DEP: Message =
    Message::new("", "'{{packageName}}' should be listed in the project's dependencies, not optionalDependencies.");
const NOT_FOUND: Message = Message::new("", "The package.json file could not be found.");
const NOT_PARSED: Message = Message::new("", "The package.json file could not be parsed: {{message}}");

/// `declarationStatus`
const IN_DEPS: u8 = 1 << 0;
const IN_DEV_DEPS: u8 = 1 << 1;
const IN_OPT_DEPS: u8 = 1 << 2;
const IN_PEER_DEPS: u8 = 1 << 3;
const IN_BUNDLED_DEPS: u8 = 1 << 4;

/// The fields that are objects.
const OBJECTS: [(&[u8], u8); 4] = [
    (b"dependencies", IN_DEPS),
    (b"devDependencies", IN_DEV_DEPS),
    (b"optionalDependencies", IN_OPT_DEPS),
    (b"peerDependencies", IN_PEER_DEPS),
];

/// What `object[name] !== undefined` finds in every object.
const INHERITED: [&[u8]; 12] = [
    b"__defineGetter__",
    b"__defineSetter__",
    b"__lookupGetter__",
    b"__lookupSetter__",
    b"__proto__",
    b"constructor",
    b"hasOwnProperty",
    b"isPrototypeOf",
    b"propertyIsEnumerable",
    b"toLocaleString",
    b"toString",
    b"valueOf",
];

/// What is reported for a `package.json` that cannot be read, with the `message` of the error.
type Failure = (Message, Vec<u8>);

/// An option that says where a field counts.
enum Config {
    Is(bool),
    Globs(GlobsFromCwd),
}

impl Config {
    fn new(options: Object, key: &str) -> Config {
        match options.get(key) {
            Some(Json::Array(_)) => Config::Globs(GlobsFromCwd::new(&options.strings(key))),
            config => Config::Is(config.and_then(Json::as_bool) != Some(false)),
        }
    }

    /// `testConfig(config, filename) !== false`
    fn allows(&self, cwd: &[u8], filename: &[u8]) -> bool {
        match self {
            Config::Is(config) => *config,
            Config::Globs(globs) => globs.matches(cwd, filename),
        }
    }
}

/// `readJSON`. `Err`: what it throws.
fn read_json(modules: &dyn Modules, json_path: &[u8]) -> Result<Json, Option<Failure>> {
    if let Some(content) = modules.read(json_path) {
        return json_parse(&content).map_err(|message| Some((NOT_PARSED, message)));
    }
    // `ENOENT`, and neither `EISDIR` nor `ENOTDIR`: what there is of the path is a directory, and not all of it.
    let found = paths::ancestors(json_path).find(|it| modules.exists(it));
    let is_missing = found.is_none_or(|it| it.len() < json_path.len() && modules.read(it).is_none());
    Err(is_missing.then(|| (NOT_FOUND, Vec::new())))
}

/// `packageContent`
#[derive(Clone, Default)]
struct DepFields {
    /// The fields that a name is in.
    fields: FxHashMap<Box<[u8]>, u8>,
    /// How long the longest name is.
    longest: usize,
}

impl DepFields {
    fn add(&mut self, name: &[u8], field: u8) {
        *self.fields.entry(name.into()).or_default() |= field;
        self.longest = self.longest.max(name.len());
    }

    /// `extractDepFields` of each of `packages`, assigned to one object in that order.
    fn new(packages: &[Json]) -> DepFields {
        let mut all = DepFields::default();
        for name in INHERITED {
            all.add(name, IN_DEPS | IN_DEV_DEPS | IN_OPT_DEPS | IN_PEER_DEPS);
        }
        let mut bundled: Vec<Option<&[u8]>> = Vec::new();
        for pkg in packages {
            for (key, field) in OBJECTS {
                for (name, _) in pkg.get(key).and_then(Json::as_object).unwrap_or_default() {
                    all.add(name, field);
                }
            }
            let bundle = pkg.get(b"bundleDependencies").filter(|it| it.is_truthy());
            // `arrayOrKeys`
            let names: Vec<Option<&[u8]>> = match bundle.or_else(|| pkg.get(b"bundledDependencies")) {
                Some(Json::Array(names)) => names.iter().map(Json::as_str).collect(),
                Some(Json::Object(entries)) => entries.iter().map(|it| Some(&it.0[..])).collect(),
                _ => Vec::new(),
            };
            // `Object.assign` of an array to an array: a name takes the place of the one with its index.
            let kept = bundled.split_off(names.len().min(bundled.len()));
            bundled = names;
            bundled.extend(kept);
        }
        for name in bundled.into_iter().flatten() {
            all.add(name, IN_BUNDLED_DEPS);
        }
        all
    }

    /// `getDependencies` for the directories of `packageDir`.
    fn in_directories(directories: &[Box<[u8]>], modules: &dyn Modules) -> (DepFields, Option<Failure>) {
        let mut packages = Vec::new();
        for dir in directories {
            let package_json_path = paths::join(&paths::resolve(modules.cwd(), dir), b"package.json");
            match read_json(modules, &package_json_path) {
                Ok(pkg) => packages.push(pkg),
                // `throwAtRead`
                Err(failure) if directories.len() == 1 => return (DepFields::new(&[]), failure),
                Err(_) => {}
            }
        }
        (DepFields::new(&packages), None)
    }

    /// `checkDependencyDeclaration`
    fn check_dependency_declaration(&self, package_name: &[u8], declaration_status: u8) -> u8 {
        let (mut status, mut start) = (declaration_status, 0);
        while let Some(rest) = package_name.get(start..).filter(|_| !package_name.is_empty()) {
            let end = start + strings::index_of_char_usize(rest, b'/').unwrap_or(rest.len());
            if end > self.longest {
                break;
            }
            if !rest.starts_with(b"@") {
                let ancestor = package_name.get(..end).unwrap_or_default();
                status |= self.fields.get(ancestor).copied().unwrap_or_default();
            }
            start = end + 1;
        }
        status
    }
}

/// `getModuleOriginalName`
fn get_module_original_name(name: &[u8]) -> Cow<'_, [u8]> {
    let is_scoped = name.starts_with(b"@");
    match strings::split_once_char(name, b'/') {
        // `second` is `undefined`.
        None if is_scoped => Cow::Owned([name, b"/undefined"].concat()),
        None => Cow::Borrowed(name),
        Some((first, rest)) if is_scoped => {
            let second = strings::index_of_char_usize(rest, b'/').unwrap_or(rest.len());
            Cow::Borrowed(&name[..first.len() + 1 + second])
        }
        Some((first, _)) => Cow::Borrowed(first),
    }
}

/// Whether `node` imports or exports nothing but types.
fn is_type_import(node: Node) -> bool {
    let Node::Stmt(node) = node else {
        return false;
    };
    match node.kind() {
        StmtKind::Import(import) if import.is_type_only() => true,
        StmtKind::Import(import) => {
            let specifiers = import.named();
            let has_others = import.default().is_some() || import.namespace().is_some();
            !has_others && !specifiers.is_empty() && specifiers.iter().all(ImportSpec::is_type_only)
        }
        StmtKind::ExportNamed(export) => export.is_type_only(),
        StmtKind::ExportStar { type_only, .. } => type_only,
        _ => false,
    }
}

impl NoExtraneousDependencies {
    /// `getDependencies` without `packageDir`.
    fn closest_to(&self, filename: &[u8], modules: &dyn Modules) -> Cow<'_, DepFields> {
        let Some(package_json_path) = pkg_up(modules, filename) else {
            return Cow::Owned(DepFields::new(&[]));
        };
        let read = || DepFields::new(read_json(modules, &package_json_path).ok().as_slice());
        for known in &self.closest {
            let (path, fields) = known.get_or_init(|| (package_json_path.as_slice().into(), read()));
            if **path == *package_json_path {
                return Cow::Borrowed(fields);
            }
        }
        Cow::Owned(read())
    }
}

impl Rule for NoExtraneousDependencies {
    const META: Meta = Meta::plugin(Plugin::Import, "no-extraneous-dependencies", Kind::Problem).needs_modules();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoExtraneousDependencies {
            configs: [
                (Config::new(options, "devDependencies"), IN_DEV_DEPS),
                (Config::new(options, "optionalDependencies"), IN_OPT_DEPS),
                (Config::new(options, "peerDependencies"), IN_PEER_DEPS),
                (Config::new(options, "bundledDependencies"), IN_BUNDLED_DEPS),
            ],
            package_dir: match options.get("packageDir") {
                Some(Json::String(dir)) if !dir.is_empty() => Some(vec![dir.as_slice().into()]),
                // `path.resolve` throws at what is no string: there are no dependencies.
                Some(Json::Array(dirs)) if !dirs.is_empty() => {
                    let dirs: Option<Vec<Box<[u8]>>> = dirs.iter().map(|it| it.as_str().map(Box::from)).collect();
                    Some(dirs.unwrap_or_default())
                }
                _ => None,
            },
            include_internal: options.bool_or("includeInternal", false),
            include_types: options.bool_or("includeTypes", false),
            visitor: Visitor::of(Systems { esmodule: true, commonjs: true, amd: false }),
            in_package_dir: OnceLock::new(),
            closest: Default::default(),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        // What is wrong with `packageDir` is reported in every file.
        (self.package_dir.is_some() || self.visitor.may_visit(file)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let file = cx.file();
        let Some(modules) = file.modules() else {
            return;
        };
        let (cwd, filename) = (modules.cwd(), paths::portable(file.path(), file.path()));
        let deps = match &self.package_dir {
            Some(directories) => {
                let read = self.in_package_dir.get_or_init(|| DepFields::in_directories(directories, modules));
                if let Some((message, error)) = &read.1 {
                    cx.report_at(0, *message).start_at(Position { line: 0, column: 0 }).data("message", error.clone());
                }
                Cow::Borrowed(&read.0)
            }
            None => self.closest_to(&filename, modules),
        };
        let allowed = self.configs.iter().filter(|it| it.0.allows(cwd, &filename)).fold(IN_DEPS, |all, it| all | it.1);
        let mut types = None;
        for visited in self.visitor.visit(file) {
            if !self.include_types && is_type_import(visited.importer) {
                continue;
            }
            let (name, is_require) = (visited.specifier, visited.is_require);
            // What is declared is not looked for: to resolve a name costs the most.
            let import_package_name = get_module_original_name(name);
            let mut declaration_status = deps.check_dependency_declaration(&import_package_name, 0);
            if declaration_status & allowed != 0 {
                continue;
            }
            let Some(types) = types.get_or_insert_with(|| ImportTypes::of(file)) else {
                return;
            };
            match types.of_name(name, is_require) {
                ImportType::External => {}
                ImportType::Internal if self.include_internal => {}
                _ => continue,
            }
            let resolved = types.resolvers().resolve(file, name, is_require);
            let Some(resolved) = resolved.file() else {
                continue;
            };
            // `getModuleRealName`
            let real_package_name = file_package_name(modules, resolved);
            if let Some(real_package_name) = real_package_name.as_deref().filter(|it| **it != *import_package_name) {
                declaration_status = deps.check_dependency_declaration(real_package_name, declaration_status);
                if declaration_status & allowed != 0 {
                    continue;
                }
            }
            let message = match declaration_status & !allowed {
                status if status & IN_DEV_DEPS != 0 => DEV_DEP,
                status if status & IN_OPT_DEPS != 0 => OPT_DEP,
                _ => MISSING,
            };
            let package_name = real_package_name.unwrap_or_else(|| import_package_name.into_owned());
            cx.report(visited.importer, message).data("packageName", package_name);
        }
    }
}
