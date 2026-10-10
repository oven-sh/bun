use bun_lint_oxlint::ast_util::{get_inner_expression, plain, static_name};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::{SmallVec, smallvec};
use std::borrow::Cow;

/// A set of styles.
type StyleSet = u8;
const NAMED: StyleSet = 1;
const NAMESPACE: StyleSet = 2;
const DEFAULT_STYLE: StyleSet = 4;
const UNASSIGNED: StyleSet = 8;

struct ModuleStylesOverride {
    module_name: Box<[u8]>,
    /// The styles that it says something about, and those of them that it allows. `None`: `false`, the module is not
    /// looked at.
    styles: Option<(StyleSet, StyleSet)>,
}

/// Enforce specific import styles per module.
pub struct ImportStyle {
    /// The last for a module counts.
    styles: Vec<ModuleStylesOverride>,
    extend_default_styles: bool,
    check_import: bool,
    check_dynamic_import: bool,
    check_export_from: bool,
    check_require: bool,
}

const IMPORT_STYLE: Message = Message::new("", "Use {{allowed_styles}} import for module `{{module_name}}`.");

impl Rule for ImportStyle {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "import-style", Kind::Suggestion);
    const ON: On = On::new()
        .stmts(&[StmtTag::Import, StmtTag::ExportStar, StmtTag::ExportNamed, StmtTag::Expr])
        .exprs(&[ExprTag::ImportCall])
        .var_decls();
    no_state!();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let module_styles = |(module_name, value): &(Vec<u8>, Json)| {
            let styles = match value {
                Json::Bool(false) => None,
                Json::Object(_) => {
                    let value = Object::of(Some(value));
                    let all = [
                        ("named", NAMED),
                        ("namespace", NAMESPACE),
                        ("default", DEFAULT_STYLE),
                        ("unassigned", UNASSIGNED),
                    ];
                    Some(all.into_iter().fold((0, 0), |(said, allowed), (key, style)| match value.bool(key) {
                        Some(is_allowed) => (said | style, if is_allowed { allowed | style } else { allowed }),
                        None => (said, allowed),
                    }))
                }
                _ => return None,
            };
            Some(ModuleStylesOverride { module_name: module_name.as_slice().into(), styles })
        };
        ImportStyle {
            styles: options.object("styles").entries().iter().filter_map(module_styles).collect(),
            extend_default_styles: options.bool_or("extendDefaultStyles", true),
            check_import: options.bool_or("checkImport", true),
            check_dynamic_import: options.bool_or("checkDynamicImport", true),
            check_export_from: options.bool_or("checkExportFrom", false),
            check_require: options.bool_or("checkRequire", true),
        }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new();
        if self.check_import {
            on = on.stmts(&[StmtTag::Import]);
        }
        if self.check_export_from {
            on = on.stmts(&[StmtTag::ExportStar, StmtTag::ExportNamed]);
        }
        let checks_require = self.check_require && file.mentions("require");
        if self.check_dynamic_import {
            on = on.exprs(&[ExprTag::ImportCall]);
        }
        if checks_require {
            on = on.stmts(&[StmtTag::Expr]);
        }
        if checks_require || self.check_dynamic_import && file.has_exprs([ExprTag::ImportCall]) {
            on = on.var_decls();
        }
        on
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        match stmt.tag() {
            StmtTag::Import => self.import(stmt, cx),
            StmtTag::ExportStar | StmtTag::ExportNamed => self.export_from(stmt, cx),
            StmtTag::Expr => self.unassigned_require(stmt, cx),
            _ => {}
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let ExprKind::ImportCall { args } = e.kind()
            && !is_assigned_dynamic_import(e)
            && let Some(source) = args.first().and_then(get_module_name)
        {
            self.report_if_needed(e.span(), &source, || UNASSIGNED, false, cx);
        }
    }

    fn var_decl<'a>(&self, declarator: VarDecl<'a>, cx: &mut Cx<'a, Self>) {
        let Some(init) = declarator.init().and_then(plain) else {
            return;
        };
        let (source, is_require) = match init.kind() {
            ExprKind::Await(argument) if self.check_dynamic_import => match plain(argument).map(Expr::kind) {
                Some(ExprKind::ImportCall { args }) => (args.first().and_then(get_module_name), false),
                _ => return,
            },
            ExprKind::Call(call_expr) if self.check_require => (get_require_module_name(call_expr), true),
            _ => return,
        };
        if let Some(source) = source {
            let actual_styles = || get_actual_assignment_target_styles(declarator.pat());
            self.report_if_needed(declarator.span(), &source, actual_styles, is_require, cx);
        }
    }
}

impl ImportStyle {
    fn import<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if let StmtKind::Import(import_decl) = stmt.kind() {
            let actual_styles = || get_actual_import_declaration_styles(import_decl);
            self.report_if_needed(stmt.span(), import_decl.spec().bytes(), actual_styles, false, cx);
        }
    }

    fn export_from<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        match stmt.kind() {
            StmtKind::ExportStar { spec: Some(source), .. } => {
                self.report_if_needed(stmt.span(), source.bytes(), || NAMESPACE, false, cx);
            }
            StmtKind::ExportNamed(export_decl) if export_decl.has_from() => {
                let is_default = |it: ExportSpec| !it.exported().is_string() && it.exported().name().is("default");
                let style = |it: ExportSpec| if is_default(it) { DEFAULT_STYLE } else { NAMED };
                let actual_styles = || match export_decl.items().is_empty() {
                    true => UNASSIGNED,
                    false => export_decl.items().iter().fold(0, |styles, it| styles | style(it)),
                };
                if let Some(source) = export_decl.spec() {
                    self.report_if_needed(stmt.span(), source.bytes(), actual_styles, false, cx);
                }
            }
            _ => {}
        }
    }

    fn unassigned_require<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if let StmtKind::Expr(e) = statement.kind()
            && let Some(source) = plain(e).and_then(Expr::as_call).and_then(get_require_module_name)
        {
            self.report_if_needed(e.span(), &source, || UNASSIGNED, true, cx);
        }
    }

    fn report_if_needed(
        &self,
        span: Span,
        module_name: &[u8],
        actual_styles: impl FnOnce() -> StyleSet,
        is_require: bool,
        cx: &Cx<Self>,
    ) {
        let Some(mut allowed_styles) = self.allowed_styles(module_name) else {
            return;
        };
        // `const path = require("path")` is what a default import is in CommonJS.
        if is_require && allowed_styles & DEFAULT_STYLE != 0 {
            allowed_styles |= NAMESPACE;
        }
        if actual_styles() & !allowed_styles != 0 {
            cx.report(span, IMPORT_STYLE)
                .data("allowed_styles", format_for_diagnostic(allowed_styles))
                .data("module_name", module_name.to_vec());
        }
    }

    fn allowed_styles(&self, module_name: &[u8]) -> Option<StyleSet> {
        let base = match module_name {
            _ if !self.extend_default_styles => None,
            b"chalk" | b"node:path" | b"path" => Some(DEFAULT_STYLE),
            b"node:util" | b"util" => Some(NAMED),
            _ => None,
        };
        let allowed_styles = match self.styles.iter().rev().find(|it| *it.module_name == *module_name) {
            Some(style_override) => {
                let (said, allowed) = style_override.styles?;
                (base.unwrap_or(0) & !said) | allowed
            }
            None => base?,
        };
        Some(allowed_styles).filter(|it| *it != 0)
    }
}

/// `named`, `named or default`, `named, namespace, or default`
fn format_for_diagnostic(styles: StyleSet) -> String {
    let all = [(NAMED, "named"), (NAMESPACE, "namespace"), (DEFAULT_STYLE, "default"), (UNASSIGNED, "unassigned")];
    let parts: SmallVec<[&str; 4]> = all.into_iter().filter(|it| styles & it.0 != 0).map(|it| it.1).collect();
    match parts.as_slice() {
        [all_but_last @ .., _, last] if !all_but_last.is_empty() => {
            format!("{}, or {last}", parts.get(..parts.len() - 1).unwrap_or_default().join(", "))
        }
        _ => parts.join(" or "),
    }
}

fn get_actual_import_declaration_styles(import_decl: Import) -> StyleSet {
    let is_default = |it: ImportSpec| !it.imported().is_string() && it.imported().name().is("default");
    let styles =
        import_decl.named().iter().fold(0, |styles, it| styles | if is_default(it) { DEFAULT_STYLE } else { NAMED })
            | if import_decl.default().is_some() { DEFAULT_STYLE } else { 0 }
            | if import_decl.namespace().is_some() { NAMESPACE } else { 0 };
    if styles == 0 { UNASSIGNED } else { styles }
}

fn get_actual_assignment_target_styles(pattern: Pat) -> StyleSet {
    let PatKind::Object(properties) = pattern.kind() else {
        return NAMESPACE;
    };
    let is_default = |it: PatProp| it.key().and_then(static_name).is_some_and(|name| name.is("default"));
    let styles = properties.iter().fold(0, |styles, it| styles | if is_default(it) { DEFAULT_STYLE } else { NAMED });
    if styles == 0 { UNASSIGNED } else { styles }
}

/// The text of `"a"`, `` `a${"b"}` ``, `"a" + "b"`.
fn get_module_name(expr: Expr<'_>) -> Option<Cow<'_, [u8]>> {
    if let Some(value) = get_inner_expression(expr).as_string() {
        return Some(Cow::Borrowed(value.bytes()));
    }
    let mut name = Vec::new();
    let mut pending: SmallVec<[Expr; 8]> = smallvec![expr];
    while let Some(expr) = pending.pop().map(get_inner_expression) {
        match expr.kind() {
            ExprKind::Binary { op: BinOp::Add, left, right } => pending.extend([right, left]),
            _ if to_js_string(expr, &mut name, 0) => {}
            _ => return None,
        }
    }
    Some(Cow::Owned(name))
}

/// `ToJsString` of `oxc_ecmascript`, for strings, templates, numbers, booleans, `null` and `void 0`.
fn to_js_string(expr: Expr, out: &mut Vec<u8>, depth: u32) -> bool {
    match expr.kind() {
        ExprKind::String(value) | ExprKind::BigInt(value) => out.extend_from_slice(value.bytes()),
        ExprKind::Number(value) => out.extend_from_slice(&text::number_to_string(value)),
        ExprKind::Null => out.extend_from_slice(b"null"),
        ExprKind::True => out.extend_from_slice(b"true"),
        ExprKind::False => out.extend_from_slice(b"false"),
        ExprKind::Unary { op: UnOp::Void, .. } => out.extend_from_slice(b"undefined"),
        ExprKind::Template(template) if depth < 32 => {
            for i in 0..template.quasi_count() {
                let Some(cooked) = template.cooked(i) else {
                    return false;
                };
                out.extend_from_slice(cooked.bytes());
                if template.exprs().get(i).is_some_and(|it| it.is_parenthesized() || !to_js_string(it, out, depth + 1))
                {
                    return false;
                }
            }
        }
        _ => return false,
    }
    true
}

/// The `"a"` of `require("a")`.
fn get_require_module_name(call_expr: Call<'_>) -> Option<Cow<'_, [u8]>> {
    let argument = call_expr.args().first().filter(|it| call_expr.args().len() == 1 && it.tag() != ExprTag::Spread)?;
    get_inner_expression(call_expr.callee()).is_ident("require").then(|| get_module_name(argument))?
}

/// `const a = await import("b")`, which is looked at as a declaration.
fn is_assigned_dynamic_import(e: Expr) -> bool {
    matches!(plain(e).map(Expr::parent), Some(Node::Expr(await_expr)) if await_expr.tag() == ExprTag::Await
        && matches!(plain(await_expr).map(Expr::parent), Some(Node::VarDecl(_))))
}
