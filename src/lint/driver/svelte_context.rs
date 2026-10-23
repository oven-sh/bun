//! The context `svelte/*` rules run under, as eslint-plugin-svelte finds it for a component (`getSvelteContext` in
//! `utils/svelte-context.ts`): the Svelte and SvelteKit major versions and what the file is to SvelteKit. Also the
//! Svelte config that svelte-eslint-parser reads: `parserOptions.svelteConfig`, or else what it can tell, without
//! running it, from the nearest `svelte.config.js` above the file (`svelte-config/parser.ts`).
//!
//! Ports parts of eslint-plugin-svelte, Copyright (c) 2021 Yosuke Ota, under the MIT License: see LICENSE.md.

use crate::fs;
use crate::paths;
use bun_collections::StringHashMap;
use bun_lint::ast::svelte::{KitFileType, SvelteContext};
use bun_lint::ast::{Expr, ExprKind, File, KeyKind, Node, PatKind, PropKind, StmtKind, VarKind};
use bun_lint::linter::{LintMessage, ResolvedConfig};
use bun_lint::options::Json;
use bun_lint::semantic::Declaration;
use bun_threading::Guarded;
use std::sync::Arc;

/// What's been found for a run's components, keyed by the paths it was found from.
#[derive(Default)]
pub(crate) struct Contexts {
    /// The major version of the Svelte that the eslint-plugin-svelte module at a path imports, and its package version.
    svelte_versions: Guarded<StringHashMap<SvelteVersion>>,
    /// What a directory finds in its ancestors.
    directories: Guarded<StringHashMap<Arc<Above>>>,
    /// Each directory's `package.json`, if it's an object.
    package_jsons: Guarded<StringHashMap<Option<Arc<Json>>>>,
    /// What svelte-eslint-parser reads from the nearest `svelte.config.js` above a directory, keyed by the directory.
    svelte_configs: Guarded<StringHashMap<SvelteConfig>>,
}

/// What svelte-eslint-parser reads from a Svelte config, or the component's fatal message if it can't parse the config,
/// which it does before parsing the component.
pub(crate) type SvelteConfig = Result<Arc<Json>, Box<LintMessage>>;

/// [`SvelteContext::svelte_version`] and [`SvelteContext::compiler_version`].
type SvelteVersion = (Option<Box<str>>, Option<Box<str>>);

/// What a directory finds in its ancestors, itself first.
struct Above {
    /// `getSvelteKitVersion`
    kit_version: Option<Box<str>>,
    /// `getProjectRootDir`: the directory of the nearest `package.json`.
    project_root: Option<Box<[u8]>>,
}

impl Contexts {
    /// The Svelte config of the component at `path`: `parserOptions.svelteConfig` if it's set, or else the nearest
    /// `svelte.config.js` above the file, or above `cwd` if there's no such file (`resolveSvelteConfigFromOption`).
    /// `Json::Null` if there's none.
    pub(crate) fn svelte_config(
        &self,
        path: &[u8],
        parser_options: &Json,
        cwd: &[u8],
    ) -> SvelteConfig {
        if let Some(given) = parser_options
            .get(b"svelteConfig")
            .filter(|it| it.is_truthy())
        {
            return Ok(Arc::new(given.clone()));
        }
        let path = paths::resolve(cwd, path);
        let start = match fs::is_file(&path) {
            true => paths::dirname(&path).to_vec(),
            false => cwd.to_vec(),
        };
        if let Some(found) = self.svelte_configs.lock().get(&start[..]) {
            return found.clone();
        }
        let mut directory = start.clone();
        // The root itself isn't searched.
        let config = loop {
            let parent = paths::dirname(&directory).to_vec();
            if parent == directory {
                break Ok(Json::Null);
            }
            let candidate = paths::join(&directory, b"svelte.config.js");
            if fs::is_file(&candidate) {
                match fs::read(&candidate) {
                    Ok(text) => break parse_svelte_config(&text),
                    // Not cached, because the next component may be able to read it.
                    Err(error) => return Err(Box::new(unreadable(&candidate, &error))),
                }
            }
            directory = parent;
        };
        let config = config.map(Arc::new);
        bun_core::handle_oom(self.svelte_configs.lock().put(&start, config.clone()));
        config
    }

    /// The context of the component at `path`, which `config` lints with `svelte_config` from
    /// [`Contexts::svelte_config`]. `runes` is the runes mode set by the options, the config or `<svelte:options>`.
    pub(crate) fn context_of(
        &self,
        path: &[u8],
        config: &ResolvedConfig,
        (svelte_config, runes): (&Json, Option<bool>),
        cwd: &[u8],
    ) -> SvelteContext {
        let path = paths::resolve(cwd, path);
        let (svelte_version, compiler_version) = self.svelte_version(config, &path);
        let above = self.above(paths::dirname(&path));
        let kit_file_type = above.kit_version.as_ref().and_then(|_| {
            kit_file_type(&path, config, svelte_config, above.project_root.as_deref())
        });
        SvelteContext {
            runes: runes.filter(|_| svelte_version.as_deref().is_some_and(|it| it != "3/4")),
            svelte_version,
            compiler_version,
            kit_version: above.kit_version.clone(),
            kit_file_type,
        }
    }

    /// True if `getSvelteKitContext` throws for the component at `path`: in a SvelteKit project whose routes aren't a
    /// string, `routes?.replace` isn't a function.
    pub(crate) fn has_kit_routes_error(
        &self,
        path: &[u8],
        config: &ResolvedConfig,
        svelte_config: &Json,
        cwd: &[u8],
    ) -> bool {
        let path = paths::resolve(cwd, path);
        let routes = routes(config, svelte_config);
        self.above(paths::dirname(&path)).kit_version.is_some()
            && routes.is_some_and(|it| it.as_str().is_none())
    }

    /// `getSvelteVersion`: the version of the `svelte` that the eslint-plugin-svelte module resolves, or the one the
    /// file resolves if the config has no such module. Svelte 5 if there's none, because eslint-plugin-svelte doesn't
    /// load without it, and the native parser is Svelte 5's. Also returns the package version.
    fn svelte_version(&self, config: &ResolvedConfig, path: &[u8]) -> SvelteVersion {
        let plugin = (config.js_plugins.iter())
            .filter_map(|it| it.module.as_deref())
            .find(|it| crate::svelte::is_svelte_plugin_module(it));
        let from = paths::from_native(plugin.unwrap_or(path));
        let from = paths::dirname(&from);
        if let Some(found) = self.svelte_versions.lock().get(from) {
            return found.clone();
        }
        let installed = (self.node_module(from, b"svelte"))
            .and_then(|it| version_of(&*self.package_json(&it)?));
        let version = match installed {
            Some(version) => (
                svelte_major(&version),
                std::str::from_utf8(&version).ok().map(Box::from),
            ),
            None => (Some("5".into()), None),
        };
        bun_core::handle_oom(self.svelte_versions.lock().put(from, version.clone()));
        version
    }

    /// `getNodeModule`: the directory of the package `name` in the `node_modules` nearest to `directory`.
    fn node_module(&self, directory: &[u8], name: &[u8]) -> Option<Vec<u8>> {
        let mut at = directory.to_vec();
        loop {
            let candidate = paths::join(&paths::join(&at, b"node_modules"), name);
            if fs::kind(&candidate) == Some(fs::Kind::Directory) {
                return Some(candidate);
            }
            let parent = paths::dirname(&at).to_vec();
            if parent == at {
                return None;
            }
            at = parent;
        }
    }

    /// The `package.json` in `directory`, if it's an object.
    fn package_json(&self, directory: &[u8]) -> Option<Arc<Json>> {
        if let Some(found) = self.package_jsons.lock().get(directory) {
            return found.clone();
        }
        let read = fs::read(&paths::join(directory, b"package.json")).ok();
        let json = read
            .and_then(|it| bun_lint::json::parse(&it))
            .filter(|it| matches!(it, Json::Object(_)))
            .map(Arc::new);
        bun_core::handle_oom(self.package_jsons.lock().put(directory, json.clone()));
        json
    }

    fn above(&self, directory: &[u8]) -> Arc<Above> {
        if let Some(found) = self.directories.lock().get(directory) {
            return Arc::clone(found);
        }
        let mut package_jsons = Vec::new();
        let mut at = directory.to_vec();
        loop {
            if let Some(json) = self.package_json(&at) {
                package_jsons.push((at.clone(), json));
            }
            let parent = paths::dirname(&at).to_vec();
            if parent == at {
                break;
            }
            at = parent;
        }
        let kit_version = self.kit_version(directory, &package_jsons);
        let above = Arc::new(Above {
            kit_version,
            project_root: package_jsons.first().map(|it| it.0.clone().into()),
        });
        bun_core::handle_oom(self.directories.lock().put(directory, Arc::clone(&above)));
        above
    }

    /// `getSvelteKitVersion`: the version of the `@sveltejs/kit` nearest to `directory`, or else from the first
    /// `package.json` above it that lists it as a dependency. 2 below eslint-plugin-svelte's own `package.json`.
    fn kit_version(
        &self,
        directory: &[u8],
        package_jsons: &[(Vec<u8>, Arc<Json>)],
    ) -> Option<Box<str>> {
        let installed = (self.node_module(directory, b"@sveltejs/kit"))
            .and_then(|it| version_of(&*self.package_json(&it)?))
            .and_then(|it| kit_major(&it));
        if installed.is_some() {
            return installed;
        }
        let (_, first) = package_jsons.first()?;
        if first.get(b"name").and_then(Json::as_str) == Some(b"eslint-plugin-svelte") {
            return Some("2".into());
        }
        package_jsons.iter().find_map(|(_, json)| {
            let version = [&b"dependencies"[..], b"devDependencies"]
                .iter()
                .find_map(|it| json.get(it)?.get(b"@sveltejs/kit"))?;
            kit_major(version.as_str()?)
        })
    }
}

fn version_of(package_json: &Json) -> Option<Vec<u8>> {
    Some(package_json.get(b"version")?.as_str()?.to_vec())
}

/// `extractMajorVersion` without prereleases: the digits before the first `.`, after a `^` or `~`.
fn major(version: &[u8]) -> Option<&[u8]> {
    let version = version
        .strip_prefix(b"^")
        .or_else(|| version.strip_prefix(b"~"))
        .unwrap_or(version);
    let digits = version.iter().take_while(|it| it.is_ascii_digit()).count();
    (digits > 0 && version.get(digits) == Some(&b'.')).then(|| &version[..digits])
}

/// `checkAndSetSvelteVersion`
fn svelte_major(version: &[u8]) -> Option<Box<str>> {
    match major(version)? {
        b"3" | b"4" => Some("3/4".into()),
        major => Some(std::str::from_utf8(major).ok()?.into()),
    }
}

/// `checkAndSetSvelteKitVersion`: a prerelease of 1 is `1.0.0-next`.
fn kit_major(version: &[u8]) -> Option<Box<str>> {
    let bare = version
        .strip_prefix(b"^")
        .or_else(|| version.strip_prefix(b"~"))
        .unwrap_or(version);
    if bare.starts_with(b"1.0.0-next") {
        return Some("1.0.0-next".into());
    }
    Some(std::str::from_utf8(major(version)?).ok()?.into())
}

/// `kit.files.routes` from `settings.svelte`, or else from the Svelte config, unless it's `null` or `undefined`.
fn routes<'j>(config: &'j ResolvedConfig, svelte_config: &'j Json) -> Option<&'j Json> {
    fn routes_of(json: &Json) -> Option<&Json> {
        let routes = json.get(b"kit")?.get(b"files")?.get(b"routes")?;
        (*routes != Json::Null).then_some(routes)
    }
    let settings = config.language.settings.get(b"svelte").and_then(routes_of);
    settings.or_else(|| routes_of(svelte_config))
}

/// `getSvelteKitFileTypeFromFilePath` for the file at `path`, if it's in the routes of the project at `project_root`:
/// `settings.svelte.kit.files.routes`, or else the Svelte config's routes, or else `src/routes`.
fn kit_file_type(
    path: &[u8],
    config: &ResolvedConfig,
    svelte_config: &Json,
    project_root: Option<&[u8]>,
) -> Option<KitFileType> {
    let routes = match routes(config, svelte_config) {
        Some(routes) => routes.as_str()?,
        None => b"src/routes",
    };
    let routes = routes.strip_prefix(b"/").unwrap_or(routes);
    let start = paths::join_normalized(project_root.unwrap_or_default(), routes);
    if !path.starts_with(&start) {
        return None;
    }
    match paths::basename(path) {
        b"+page.svelte" => Some(KitFileType::Page),
        b"+error.svelte" => Some(KitFileType::Error),
        b"+layout.svelte" => Some(KitFileType::Layout),
        _ => None,
    }
}

/// What `readFileSync` throws when svelte-eslint-parser can't read the config at `path`: the component's fatal message,
/// which ESLint reports without a position.
fn unreadable(path: &[u8], error: &bun_sys::Error) -> LintMessage {
    let (code, label) = error
        .uv_code_label()
        .unwrap_or(("UNKNOWN", "unknown error"));
    let path = paths::to_native(path.to_vec());
    let parts: [&[u8]; 7] = [
        b"Parsing error: ",
        code.as_bytes(),
        b": ",
        label.as_bytes(),
        b", open '",
        &path,
        b"'",
    ];
    LintMessage {
        message: parts.concat(),
        is_fatal: true,
        severity: bun_lint::context::Severity::Error,
        ..LintMessage::default()
    }
}

/// `parseConfig`: what svelte-eslint-parser can tell about a `svelte.config.js` without running it. The default export,
/// if it's an object, provides `compilerOptions.runes` and `kit.files` where those are known. If espree can't parse the
/// file, its error becomes the component's fatal message, with the position in the config.
fn parse_svelte_config(text: &[u8]) -> Result<Json, Box<LintMessage>> {
    let mut config = Ok(Json::Object(Vec::new()));
    crate::fmt::parse_as_linted(
        b"svelte.config.js",
        text,
        &bun_lint::language::LanguageOptions::default(),
        &mut |file| {
            config = match bun_lint::linter::parse_error(file) {
                Some(fatal) => Err(Box::new(fatal)),
                None => Ok(parse_exported_config(file)),
            };
        },
    );
    config
}

fn parse_exported_config<'a>(file: &'a File<'a>) -> Json {
    let exported = file.body().iter().find_map(|it| match it.kind() {
        StmtKind::ExportDefault(e) => Some(e),
        _ => None,
    });
    let Some(Value::Object(config)) = exported.and_then(|it| evaluate(it, 0)) else {
        return Json::Object(Vec::new());
    };
    let mut out = Vec::new();
    if let Some(Value::Object(options)) = property(config, b"compilerOptions", 0) {
        let runes = property(options, b"runes", 0).and_then(|it| statically(it, 0));
        let mut entries = Vec::new();
        if let Some(Some(runes)) = runes.filter(|it| it.as_ref() != Some(&Json::Null)) {
            entries.push((b"runes".to_vec(), Json::Bool(runes.is_truthy())));
        }
        out.push((b"compilerOptions".to_vec(), Json::Object(entries)));
    }
    if let Some(Value::Object(kit)) = property(config, b"kit", 0) {
        let files = property(kit, b"files", 0).and_then(|it| statically(it, 0));
        let mut entries = Vec::new();
        if let Some(Some(files)) = files.filter(|it| it.as_ref() != Some(&Json::Null)) {
            entries.push((b"files".to_vec(), files));
        }
        out.push((b"kit".to_vec(), Json::Object(entries)));
    }
    Json::Object(out)
}

/// How `svelte-config/parser.ts` evaluates an expression: a known value, or an object literal whose properties it
/// inspects one by one.
#[derive(Copy, Clone)]
enum Value<'a> {
    Undefined,
    Literal(Option<&'a [u8]>, Literal),
    Object(Expr<'a>),
}

#[derive(Copy, Clone)]
enum Literal {
    Null,
    Bool(bool),
    Number(f64),
    /// A string. Its value is the text of the [`Value::Literal`].
    String,
    /// A `BigInt`, which is falsy if it's `0n`. True if it isn't.
    BigInt(bool),
    /// A regular expression.
    Other,
}

/// A chain of constants deeper than this is treated as a cycle.
const MOST: u32 = 64;

/// `parseExpression`: a literal, an object literal, or the identifier of a constant whose value is one.
fn evaluate(e: Expr<'_>, depth: u32) -> Option<Value<'_>> {
    if depth > MOST {
        return None;
    }
    match e.kind() {
        ExprKind::Null => Some(Value::Literal(None, Literal::Null)),
        ExprKind::True => Some(Value::Literal(None, Literal::Bool(true))),
        ExprKind::False => Some(Value::Literal(None, Literal::Bool(false))),
        ExprKind::Number(n) => Some(Value::Literal(None, Literal::Number(n))),
        ExprKind::String(value) => Some(Value::Literal(Some(value.bytes()), Literal::String)),
        ExprKind::BigInt(_) => Some(Value::Literal(None, Literal::BigInt(!is_zero(e.text())))),
        ExprKind::Regex(_) => Some(Value::Literal(None, Literal::Other)),
        ExprKind::Object(_) => Some(Value::Object(e)),
        ExprKind::Ident(name) => {
            let Some(symbol) = e.symbol() else {
                return name.is("undefined").then_some(Value::Undefined);
            };
            let pat = definition(symbol, depth)?;
            let declarator = declarator_of(pat)?;
            if declarator.var_kind() != VarKind::Const {
                return None;
            }
            let mut value = evaluate(declarator.init()?, depth + 1)?;
            for step in path_in(pat, declarator.pat()).unwrap_or_default() {
                value = match step {
                    Step::Member(name) => match value {
                        Value::Object(object) => property(object, &name, depth + 1)?,
                        _ => return None,
                    },
                    Step::Default(default) => match value {
                        Value::Undefined => evaluate(default, depth + 1)?,
                        known => known,
                    },
                };
            }
            Some(value)
        }
        _ => None,
    }
}

/// True if the `BigInt` literal `text` is `0n`, in any base.
fn is_zero(text: &[u8]) -> bool {
    let digits = text.strip_suffix(b"n").unwrap_or(text);
    let is_prefixed = digits.get(..2).is_some_and(|prefix| {
        [&b"0x"[..], b"0o", b"0b"]
            .iter()
            .any(|it| prefix.eq_ignore_ascii_case(it))
    });
    let digits = match is_prefixed {
        true => digits.get(2..).unwrap_or_default(),
        false => digits,
    };
    digits.iter().all(|it| matches!(it, b'0' | b'_'))
}

/// `getIdentifierDefinitions` for a variable declared by a `const` with an initializer: the pattern that names it. For
/// a name with more than one declaration, the first one declares a constant that's another name, whose declarations
/// count.
fn definition<'a>(
    symbol: bun_lint::semantic::Symbol<'a>,
    depth: u32,
) -> Option<bun_lint::ast::Pat<'a>> {
    if depth > MOST {
        return None;
    }
    let mut declarations = symbol.declarations();
    let first = declarations.next()?;
    let Declaration::Var(pat) = first else {
        return None;
    };
    if declarations.next().is_none() {
        return Some(pat);
    }
    let declarator = declarator_of(pat)?;
    let init = declarator
        .init()
        .filter(|_| declarator.var_kind() == VarKind::Const && declarator.pat() == pat)?;
    init.as_ident()?;
    definition(init.symbol()?, depth + 1)
}

/// The declarator whose pattern contains `pat`.
fn declarator_of(pat: bun_lint::ast::Pat<'_>) -> Option<bun_lint::ast::VarDecl<'_>> {
    let mut at = pat.parent();
    loop {
        match at {
            Node::VarDecl(declarator) => return Some(declarator),
            Node::PatProp(_) | Node::PatElem(_) | Node::Pat(_) => at = at.parent(),
            _ => return None,
        }
    }
}

/// A step `parsePatternAssign` takes from a declarator's initializer to the name it declares.
enum Step<'a> {
    /// The property with that name: an object pattern's key, or an array pattern's index.
    Member(Vec<u8>),
    /// The default, used if the value is `undefined`.
    Default(Expr<'a>),
}

/// `parsePatternAssign`: the steps from `root`, a declarator's pattern, to `target` inside it. In an object pattern it
/// looks at the first property whose name it can tell, and in an array pattern at the first element, regardless of
/// which one contains `target`.
fn path_in<'a>(
    target: bun_lint::ast::Pat<'a>,
    root: bun_lint::ast::Pat<'a>,
) -> Option<Vec<Step<'a>>> {
    if root == target {
        return Some(Vec::new());
    }
    let (name, default, value) = match root.kind() {
        PatKind::Object(props) => {
            let prop = props
                .iter()
                .find(|prop| !prop.is_rest() && pattern_key(*prop).is_some())?;
            (pattern_key(prop)?, prop.default(), prop.value())
        }
        PatKind::Array(elements) => {
            let (index, element) =
                (elements.iter().enumerate()).find(|(_, it)| it.pat().is_some())?;
            if element.is_rest() {
                return None;
            }
            let name = bun_lint::utils::text::number_to_string(index as f64);
            (name, element.default(), element.pat()?)
        }
        _ => return None,
    };
    let mut steps = vec![Step::Member(name)];
    steps.extend(default.map(Step::Default));
    steps.extend(path_in(target, value)?);
    Some(steps)
}

/// The name of an object pattern property as `parsePatternAssign` reads it: from a name or a literal, and not empty.
fn pattern_key(prop: bun_lint::ast::PatProp<'_>) -> Option<Vec<u8>> {
    let name = match prop.key()?.kind() {
        KeyKind::Ident(name)
        | KeyKind::String(name)
        | KeyKind::Number(name)
        | KeyKind::ComputedString(name)
        | KeyKind::ComputedNumber(name) => name.bytes().to_vec(),
        _ => return None,
    };
    (!name.is_empty()).then_some(name)
}

/// `EvaluatedObject#getProperty`: the value of the last property named `key` in `object`, or in what it spreads. `None`
/// if some property might be it.
fn property<'a>(object: Expr<'a>, key: &[u8], depth: u32) -> Option<Value<'a>> {
    let props = object.as_object()?;
    let mut is_unknown = false;
    for prop in props.iter().rev() {
        if prop.kind() == PropKind::Spread {
            if let Some(Value::Object(spread)) = prop.value().and_then(|it| evaluate(it, depth + 1))
                && let Some(value) = property(spread, key, depth + 1)
            {
                return Some(value);
            }
            is_unknown = true;
            continue;
        }
        match key_of(prop, depth) {
            Some(name) if name == key => {
                return match prop.kind() {
                    PropKind::Init | PropKind::Shorthand => evaluate(prop.value()?, depth + 1),
                    _ => None,
                };
            }
            Some(_) => {}
            None => is_unknown = true,
        }
    }
    (!is_unknown).then_some(Value::Undefined)
}

/// `EvaluatedObject#getKey`
fn key_of(prop: bun_lint::ast::Prop<'_>, depth: u32) -> Option<Vec<u8>> {
    match prop.key()?.kind() {
        KeyKind::Ident(name)
        | KeyKind::String(name)
        | KeyKind::Number(name)
        | KeyKind::ComputedString(name)
        | KeyKind::ComputedNumber(name) => Some(name.bytes().to_vec()),
        KeyKind::Computed(e) => match statically(evaluate(e, depth + 1)?, depth + 1)? {
            None => Some(b"undefined".to_vec()),
            Some(Json::String(ref it)) => Some(it.clone()),
            Some(Json::Null) => Some(b"null".to_vec()),
            Some(Json::Bool(it)) => Some(if it {
                b"true".to_vec()
            } else {
                b"false".to_vec()
            }),
            Some(Json::Number(it)) => Some(bun_lint::utils::text::number_to_string(it)),
            Some(_) => None,
        },
        KeyKind::Private(_) => None,
    }
}

/// `getStatic`: the whole value, if all of it is known. `Some(None)` means `undefined`.
fn statically(value: Value<'_>, depth: u32) -> Option<Option<Json>> {
    if depth > MOST {
        return None;
    }
    let object = match value {
        Value::Undefined => return Some(None),
        Value::Literal(text, literal) => {
            return Some(Some(match literal {
                Literal::Null => Json::Null,
                Literal::Bool(it) => Json::Bool(it),
                Literal::Number(it) => Json::Number(it),
                Literal::String => Json::String(text.unwrap_or_default().to_vec()),
                // Falsy or not, and not a string.
                Literal::BigInt(is_nonzero) => Json::Number(f64::from(u8::from(is_nonzero))),
                // Truthy, and not a string.
                Literal::Other => Json::Array(Vec::new()),
            }));
        }
        Value::Object(object) => object,
    };
    let mut entries: Vec<(Vec<u8>, Json)> = Vec::new();
    let mut set = |name: Vec<u8>, value: Option<Json>| {
        entries.retain(|it| it.0 != name);
        if let Some(value) = value {
            entries.push((name, value));
        }
    };
    for prop in object.as_object()?.iter() {
        if prop.kind() == PropKind::Spread {
            let spread = statically(evaluate(prop.value()?, depth + 1)?, depth + 1)?;
            if let Some(Json::Object(ref spread)) = spread {
                for (name, value) in spread {
                    set(name.clone(), Some(value.clone()));
                }
            }
            continue;
        }
        let name = key_of(prop, depth)?;
        let value = match prop.kind() {
            PropKind::Init | PropKind::Shorthand => evaluate(prop.value()?, depth + 1)?,
            _ => return None,
        };
        set(name, statically(value, depth + 1)?);
    }
    Some(Some(Json::Object(entries)))
}
