use crate::import_minimatch::Glob;
use crate::import_resolve::Resolved;
use crate::import_type::{ImportTypes, is_scoped};
use crate::module_visitor::{self, Systems, Visited, Visitor};
use bun_lint_oxlint::ast_util::is_enabled_global;
use bun_lint_oxlint::import::is_nodejs_builtin_module;
use bun_lint_oxlint::module_record::{get_loaded_module, is_waiting_for_modules, requested_modules};
use bun_lint_oxlint::text::{file_extension, file_name, glob_match};
use bun_core::strings;
use bun_lint::paths;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashMap;
use std::borrow::Cow;

/// Ensure consistent use of file extension within the import path.
pub struct Extensions {
    /// The options as the original reads them. What follows: as oxlint does.
    props: Props,
    ignore_packages: bool,
    require_extension: Option<ExtensionRule>,
    check_type_imports: bool,
    extensions: FxHashMap<Box<[u8]>, ExtensionRule>,
    path_group_overrides: Vec<PathGroupOverride>,
}

const MISSING: Message = Message::new("", "Missing file extension {{extension}}for \"{{importPath}}\"");
const UNEXPECTED: Message =
    Message::new("", "Unexpected use of file extension \"{{extension}}\" for \"{{importPath}}\"");
const EXTENSION_SHOULD_NOT_BE_INCLUDED: Message =
    Message::new("", "File extension \"{{extension}}\" should not be included in the {{import_or_export}} declaration.");
const EXTENSION_MISSING: Message = Message::new("", "Missing file extension in {{import_or_export}} declaration.");

#[derive(Copy, Clone, PartialEq, Eq)]
enum ExtensionRule {
    Always,
    Never,
    IgnorePackages,
}

impl ExtensionRule {
    fn from_json(value: &Json) -> Option<ExtensionRule> {
        match value.as_str()? {
            b"always" => Some(ExtensionRule::Always),
            b"never" => Some(ExtensionRule::Never),
            b"ignorePackages" => Some(ExtensionRule::IgnorePackages),
            _ => None,
        }
    }
}

struct PathGroupOverride {
    pattern: Box<[u8]>,
    /// `action: "enforce"`, not `"ignore"`.
    enforces: bool,
}

/// What `buildProperties` returns.
struct Props {
    default_config: ExtensionRule,
    pattern: FxHashMap<Box<[u8]>, ExtensionRule>,
    ignore_packages: bool,
    check_type_imports: bool,
    /// Each with whether its `action` is "enforce", not "ignore".
    path_group_overrides: Vec<(Glob, bool)>,
}

const SYSTEMS: Systems = Systems { esmodule: true, commonjs: true, amd: false };

/// For oxlint: the extension of the file that each specifier of an `import` or an `export .. from` stands for, in lower
/// case.
pub struct State<'a>(FxHashMap<Name<'a>, Option<Vec<u8>>>);

impl Rule for Extensions {
    const META: Meta = Meta::plugin(Plugin::Import, "extensions", Kind::Suggestion).needs_modules();
    const ON: On = On::new().exprs(&[ExprTag::Call]).finish();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let props = Props::new(options);
        let Some(first) = options.get(0) else {
            return Extensions::from_json_value(props, None, None);
        };
        if first.as_str().is_none() {
            return Extensions::from_json_value(props, Some(first), None);
        }
        // What is beside a `pattern` is not read.
        let root = options.get(1).map(|it| it.get(b"pattern").unwrap_or(it));
        Extensions::from_json_value(props, root, ExtensionRule::from_json(first))
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new().finish();
        if file.language().is_oxlint && file.mentions("require") {
            on = on.exprs(&[ExprTag::Call]);
        }
        on
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        if !file.language().is_oxlint {
            return Visitor::of(SYSTEMS).may_visit(file).then(|| State(FxHashMap::default()));
        }
        let enforces_nothing = self.require_extension.is_none() && self.extensions.is_empty() && self.path_group_overrides.is_empty();
        if !enforces_nothing && !is_waiting_for_modules(file) {
            // Before the calls are looked at.
            let mut resolved = FxHashMap::default();
            for (module_name, _) in requested_modules(file) {
                resolved.insert(module_name, get_loaded_module(file, module_name.bytes()).and_then(|it| extension_of_path(it.path())));
            }
            return Some(State(resolved));
        }
        None
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        self.check_call(e, cx);
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        // oxlint asks its record of the modules, which is of the files that are linted. The original asks the resolver.
        if cx.language().is_oxlint {
            if !cx.state.0.is_empty() {
                self.check_module_record(cx);
            }
        } else if let Some(types) = ImportTypes::of(cx.file()) {
            for visited in module_visitor::visit(cx.file(), SYSTEMS) {
                self.props.check_file_extension(&visited, &types, cx);
            }
        }
    }
}

/// `isExternalRootModule`
fn is_external_root_module(file: &[u8]) -> bool {
    match strings::count_char(file, b'/') {
        0 => !matches!(file, b"." | b".."),
        1 => is_scoped(file),
        _ => false,
    }
}

/// `path.replace(/\?(.*)$/, "")`, where a `.` is no line break.
fn without_query_string(path: &[u8]) -> &[u8] {
    let last_line = strings::js_lines(path).last().unwrap_or(path);
    match strings::index_of_char_usize(last_line, b'?') {
        Some(at) => &path[..path.len() - last_line.len() + at],
        None => path,
    }
}

/// `node.importKind === "type" || node.exportKind === "type"`
fn is_type_only(node: Node) -> bool {
    let Node::Stmt(node) = node else {
        return false;
    };
    match node.kind() {
        StmtKind::Import(import) => import.is_type_only(),
        StmtKind::ExportNamed(export) => export.is_type_only(),
        StmtKind::ExportStar { type_only, .. } => type_only,
        _ => false,
    }
}

impl Props {
    /// `buildProperties`
    fn new(options: &Options) -> Props {
        let mut result = Props {
            default_config: ExtensionRule::Never,
            pattern: FxHashMap::default(),
            ignore_packages: false,
            check_type_imports: false,
            path_group_overrides: Vec::new(),
        };
        for obj in options.all() {
            if obj.as_str().is_some() {
                result.default_config = ExtensionRule::from_json(obj).unwrap_or(result.default_config);
                continue;
            }
            let obj = Object::of(Some(obj));
            if !(obj.has("pattern") || obj.has("ignorePackages") || obj.has("checkTypeImports")) {
                result.assign(obj);
                continue;
            }
            result.assign(obj.object("pattern"));
            result.ignore_packages = obj.bool_or("ignorePackages", result.ignore_packages);
            result.check_type_imports = obj.bool_or("checkTypeImports", result.check_type_imports);
            if obj.has("pathGroupOverrides") {
                let read = |it: Object| (Glob::of_path_group(it), it.str("action") == Some("enforce"));
                let overrides = obj.array("pathGroupOverrides").iter();
                result.path_group_overrides = overrides.map(|it| read(Object::of(Some(it)))).collect();
            }
        }
        if result.default_config == ExtensionRule::IgnorePackages {
            (result.default_config, result.ignore_packages) = (ExtensionRule::Always, true);
        }
        result
    }

    /// `Object.assign(result.pattern, obj)`
    fn assign(&mut self, obj: Object) {
        for (extension, value) in obj.entries() {
            // What is neither "always" nor "never" asks for nothing. What is falsy gives way to the default.
            let other = || value.is_truthy().then_some(ExtensionRule::IgnorePackages);
            match ExtensionRule::from_json(value).or_else(other) {
                Some(rule) => self.pattern.insert(extension.as_slice().into(), rule),
                None => self.pattern.remove(extension.as_slice()),
            };
        }
    }

    /// `getModifier`
    fn modifier(&self, extension: &[u8]) -> ExtensionRule {
        self.pattern.get(extension).copied().unwrap_or(self.default_config)
    }

    /// `checkFileExtension`
    fn check_file_extension<'a>(&self, visited: &Visited<'a>, types: &ImportTypes<'a>, cx: &Cx<'a, Extensions>) {
        let import_path_with_query_string = visited.specifier;
        if import_path_with_query_string.is_empty() {
            return;
        }
        let mut overrides = self.path_group_overrides.iter();
        let is_overridden = match overrides.find(|it| it.0.matches(import_path_with_query_string)) {
            Some((_, enforces)) if !enforces => return,
            action => action.is_some(),
        };
        if !is_overridden && types.is_built_in(import_path_with_query_string, None) {
            return;
        }
        let import_path = without_query_string(import_path_with_query_string);
        if !is_overridden && is_external_root_module(import_path) {
            return;
        }
        let resolve = |name: &[u8]| types.resolvers().resolve(cx.file(), name, visited.is_require);
        let resolved_path = resolve(import_path);
        let extension = paths::extname(resolved_path.file().unwrap_or(import_path)).get(1..).unwrap_or_default();
        let before_extension = import_path.strip_suffix(extension).filter(|_| !extension.is_empty());
        let is_written = before_extension.is_some_and(|it| it.ends_with(b"."));
        if !is_written {
            let is_package = || types.is_external_module(import_path, &resolved_path) || is_scoped(import_path);
            if self.modifier(extension) == ExtensionRule::Always
                && (self.check_type_imports || !is_type_only(visited.importer))
                && !(self.ignore_packages && !is_overridden && is_package())
            {
                let quoted = if extension.is_empty() { Vec::new() } else { [&b"\""[..], extension, b"\" "].concat() };
                cx.report(visited.source, MISSING)
                    .data("extension", quoted)
                    .data("importPath", import_path_with_query_string);
            }
        } else if self.modifier(extension) == ExtensionRule::Never {
            // `isResolvableWithoutExtension`. Without an extension, `file.slice(0, -0)` is empty.
            let file_without_extension = match paths::extname(import_path) {
                b"" => &b""[..],
                extension => &import_path[..import_path.len() - extension.len()],
            };
            let is_resolvable_without_extension = match (resolve(file_without_extension), &resolved_path) {
                (Resolved::File(without), Resolved::File(with)) => without == *with,
                (Resolved::Builtin, Resolved::Builtin) | (Resolved::Nothing, Resolved::Nothing) => true,
                _ => false,
            };
            if is_resolvable_without_extension {
                cx.report(visited.source, UNEXPECTED)
                    .data("extension", extension.to_vec())
                    .data("importPath", import_path_with_query_string);
            }
        }
    }
}

/// `Path::extension`, in lower case.
fn extension_of_path(path: &[u8]) -> Option<Vec<u8>> {
    file_extension(path).map(<[u8]>::to_ascii_lowercase)
}

fn is_standard_extension(extension: &[u8]) -> bool {
    matches!(extension, b"js" | b"jsx" | b"ts" | b"tsx" | b"mjs" | b"cjs" | b"json")
}

impl Extensions {
    fn from_json_value(props: Props, value: Option<&Json>, default: Option<ExtensionRule>) -> Self {
        let object = Object::of(value);
        // "ignorePackages" is "always" with `ignorePackages: true`.
        let (default, default_ignore_packages) = match default {
            Some(ExtensionRule::IgnorePackages) => (Some(ExtensionRule::Always), true),
            _ => (default, false),
        };
        let is_extension = |key: &[u8]| !matches!(key, b"ignorePackages" | b"checkTypeImports" | b"pattern" | b"pathGroupOverrides");
        let path_group_override = |it: &Json| {
            let enforces = match it.get(b"action")?.as_str()? {
                b"enforce" => true,
                b"ignore" => false,
                _ => return None,
            };
            Some(PathGroupOverride { pattern: it.get(b"pattern")?.as_str()?.into(), enforces })
        };
        Extensions {
            props,
            ignore_packages: object.bool_or("ignorePackages", default_ignore_packages),
            require_extension: default,
            check_type_imports: object.bool_or("checkTypeImports", false),
            extensions: (object.entries().iter().filter(|it| is_extension(&it.0)))
                .filter_map(|it| Some((it.0.as_slice().into(), ExtensionRule::from_json(&it.1)?)))
                .collect(),
            path_group_overrides: object.array("pathGroupOverrides").iter().filter_map(path_group_override).collect(),
        }
    }

    fn has_rule(&self, extension: &[u8]) -> bool {
        self.extensions.contains_key(extension)
    }

    fn is_always(&self, extension: &[u8]) -> bool {
        self.extensions.get(extension) == Some(&ExtensionRule::Always)
    }

    fn is_never(&self, extension: &[u8]) -> bool {
        self.extensions.get(extension) == Some(&ExtensionRule::Never)
    }

    fn has_any_never_rules(&self) -> bool {
        self.require_extension == Some(ExtensionRule::Never)
            || [&b"js"[..], b"jsx", b"ts", b"tsx", b"mjs", b"cjs", b"json"].iter().any(|it| self.is_never(it))
    }

    fn should_flag_extension(&self, extension: &[u8], extension_is_written: bool, has_resolved_extension: bool) -> bool {
        match (extension_is_written, self.require_extension) {
            (true, Some(ExtensionRule::Never)) => !self.is_always(extension),
            (true, _) => self.is_never(extension),
            (false, Some(ExtensionRule::Always)) if has_resolved_extension => !self.is_never(extension),
            (false, Some(ExtensionRule::Always)) => !self.has_any_never_rules(),
            (false, _) => self.is_always(extension),
        }
    }

    fn check_call<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call().filter(|it| it.callee().is_ident("require") && !it.callee().is_parenthesized()) else {
            return;
        };
        for module_name in call.args().iter().filter(|it| !it.is_parenthesized()).filter_map(Expr::as_string) {
            self.process_import(module_name, e.span(), true, cx);
        }
    }

    fn check_module_record<'a>(&self, cx: &mut Cx<'a, Self>) {
        for (module_name, modules) in requested_modules(cx.file()) {
            for module in modules {
                if self.check_type_imports || !module.is_type {
                    self.process_import(module_name, module.statement_span, module.is_import, cx);
                }
            }
        }
    }

    fn process_import<'a>(&self, name: Name<'a>, span: Span, is_import: bool, cx: &Cx<'a, Self>) {
        let module_name = name.bytes();
        let path_group_action = self.path_group_overrides.iter().find(|it| glob_match(&it.pattern, module_name));
        if path_group_action.is_some_and(|it| !it.enforces) || is_nodejs_builtin_module(module_name) || is_enabled_global(cx, module_name) {
            return;
        }
        // `ignorePackages` is about "always" only.
        if self.ignore_packages && self.require_extension == Some(ExtensionRule::Always) && is_package_import(module_name) {
            return;
        }
        let resolved_extension = cx.state.0.get(&name).and_then(|it| it.as_deref());
        // In the name of a package a dot is part of the name.
        let written_extension = match is_root_package_import(module_name) && path_group_action.is_none() {
            true => None,
            false => get_file_extension_from_module_name(module_name),
        };
        self.validate_extension(resolved_extension, written_extension.as_deref(), span, is_import, cx);
    }

    fn validate_extension(
        &self,
        resolved_extension: Option<&[u8]>,
        written_extension: Option<&[u8]>,
        span: Span,
        is_import: bool,
        cx: &Cx<'_, Self>,
    ) {
        let import_or_export = if is_import { "import" } else { "export" };
        // `./a.js` can stand for `./a.ts`: what is written counts. Not the `stories` of `./a.stories`, which stands for
        // `./a.stories.tsx`.
        let written_is_genuine_extension = written_extension
            .is_some_and(|written| resolved_extension != Some(written) && (is_standard_extension(written) || self.has_rule(written)));
        let extension_to_check = match written_is_genuine_extension {
            true => written_extension,
            false => resolved_extension.or(written_extension),
        };
        let Some(extension) = extension_to_check else {
            if self.require_extension == Some(ExtensionRule::Always) && !self.has_any_never_rules() {
                cx.report(span, EXTENSION_MISSING).data("import_or_export", import_or_export);
            }
            return;
        };
        if self.require_extension.is_none() && !is_standard_extension(extension) && !self.has_rule(extension) {
            return;
        }
        let extension_is_written = written_is_genuine_extension
            || match resolved_extension {
                Some(_) => written_extension == resolved_extension,
                None => written_extension.is_some(),
            };
        if !self.should_flag_extension(extension, extension_is_written, resolved_extension.is_some()) {
            return;
        }
        if extension_is_written {
            cx.report(span, EXTENSION_SHOULD_NOT_BE_INCLUDED)
                .data("extension", extension.to_vec())
                .data("import_or_export", import_or_export);
        } else {
            cx.report(span, EXTENSION_MISSING).data("import_or_export", import_or_export);
        }
    }
}

/// `lodash`, `@babel/core`. Not `lodash/fp`.
fn is_root_package_import(module_name: &[u8]) -> bool {
    is_package_import(module_name) && strings::count_char(module_name, b'/') == usize::from(module_name.starts_with(b"@"))
}

fn is_package_import(module_name: &[u8]) -> bool {
    match module_name {
        [b'.' | b'/', ..] => false,
        // `@/a` is an alias of a path, `@a/b` a package with a scope.
        [b'@', b'/', ..] => false,
        [b'@', rest @ ..] => strings::contains_char(rest, b'/'),
        // `~/a`, `#/a`
        [_, b'/', ..] => false,
        _ => true,
    }
}

fn get_file_extension_from_module_name(module_name: &[u8]) -> Option<Cow<'_, [u8]>> {
    let path = strings::split_once_char(module_name, b'?').map_or(module_name, |it| it.0);
    let extension = strings::rsplit_once_char(file_name(path), b'.')?.1;
    match extension.iter().any(u8::is_ascii_uppercase) {
        _ if extension.is_empty() => None,
        true => Some(Cow::Owned(extension.to_ascii_lowercase())),
        false => Some(Cow::Borrowed(extension)),
    }
}
