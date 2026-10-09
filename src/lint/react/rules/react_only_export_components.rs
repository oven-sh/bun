use bun_lint_oxlint::ast_util::{as_call_expression, get_inner_expression, is_react_component_name, plain};
use bun_lint_oxlint::import::{import_declarations, is_export_declaration, module_items};
use crate::react::is_es6_component;
use bun_lint_oxlint::text::{file_extension, file_name};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use smallvec::{SmallVec, smallvec};

/// Ensure modules only export React components (and related HMR-safe items) for Fast Refresh compatibility.
pub struct OnlyExportComponents {
    allow_export_names: Vec<Box<[u8]>>,
    allow_constant_export: bool,
    allow_compound_components: bool,
    custom_hocs: Vec<Box<[u8]>>,
    check_js: bool,
}

const EXPORT_ALL_COMPONENTS: Message =
    Message::new("", "This rule can't verify that `export *` only exports components.");
const NAMED_EXPORT_COMPONENTS: Message = Message::new(
    "",
    "Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components.",
);
const ANONYMOUS_COMPONENTS: Message =
    Message::new("", "Fast refresh can't handle anonymous components. Add a name to your export.");
const LOCAL_COMPONENTS: Message = Message::new(
    "",
    "Fast refresh only works when a file only exports components. Move your component(s) to a separate file.",
);
const NO_EXPORT: Message =
    Message::new("", "Fast refresh only works when a file has exports. Move your component(s) to a separate file.");
const REACT_CONTEXT: Message = Message::new(
    "",
    "Fast refresh only works when a file only exports components. Move your React context(s) to a separate file.",
);

impl Rule for OnlyExportComponents {
    const META: Meta = Meta::oxlint(Plugin::React, "only-export-components", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let names = |key: &str| options.strings(key).into_iter().map(|it| it.as_bytes().into()).collect();
        OnlyExportComponents {
            allow_export_names: names("allowExportNames"),
            allow_constant_export: options.bool_or("allowConstantExport", false),
            allow_compound_components: options.bool_or("allowCompoundComponents", false),
            custom_hocs: names("customHOCs"),
            check_js: options.bool_or("checkJS", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        let is_extension = |extension: &str| {
            file_extension(file.path()).is_some_and(|it| it.eq_ignore_ascii_case(extension.as_bytes()))
        };
        let filename = file_name(file.path());
        if !(is_extension("tsx") || is_extension("jsx") || self.check_js && is_extension("js"))
            || [&b".test."[..], b".spec.", b".cy.", b".stories."].into_iter().any(|it| strings::contains(filename, it))
        {
            return;
        }
        // Something is imported from it: `import "react"` does not count.
        let imports_from_react = |it: Import| {
            it.spec().is("react") && (it.default().is_some() || it.namespace().is_some() || !it.named().is_empty())
        };
        if self.check_js && !import_declarations(file).any(imports_from_react) {
            return;
        }
        on.finish(|rule, cx| rule.run_once(cx));
    }
}

#[derive(Default)]
struct ExportAnalysis {
    has_react_export: bool,
    non_component_exports: Vec<Span>,
    react_context_exports: Vec<Span>,
}

#[derive(Copy, Clone)]
enum ExportType {
    ReactComponent,
    NonComponent(Span),
    ReactContext(Span),
    Allowed,
}

impl ExportAnalysis {
    fn add_export(&mut self, export_type: ExportType) {
        match export_type {
            ExportType::ReactComponent => self.has_react_export = true,
            ExportType::NonComponent(span) => self.non_component_exports.push(span),
            ExportType::ReactContext(span) => self.react_context_exports.push(span),
            ExportType::Allowed => {}
        }
    }
}

/// `e` of `e as T` and `e satisfies T`. One of them only.
fn skip_ts_expression(exp: Expr<'_>) -> Expr<'_> {
    match exp.tag() {
        ExprTag::As | ExprTag::AsConst | ExprTag::Satisfies if !exp.is_parenthesized() => exp.operand().unwrap_or(exp),
        _ => exp,
    }
}

fn as_identifier(e: Expr<'_>) -> Option<Name<'_>> {
    plain(e)?.as_ident()
}

/// `function a() {}`, not `function () {}`
fn is_named_function_expression(e: Expr) -> bool {
    plain(e).and_then(Expr::as_fn).is_some_and(|it| it.kind() == FnKind::Expr && it.name().is_some())
}

fn is_arrow_function_expression(e: Expr) -> bool {
    plain(e).and_then(Expr::as_fn).is_some_and(Func::is_arrow)
}

/// A boolean, a number, a string, a template, `-a`, `a + b`.
fn is_constant_export_expression(e: Expr) -> bool {
    !e.is_parenthesized()
        && match e.kind() {
            ExprKind::True | ExprKind::False | ExprKind::Number(_) | ExprKind::String(_) | ExprKind::Template(_) => {
                true
            }
            ExprKind::Unary { op, .. } => !matches!(op, UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec),
            ExprKind::Binary { op, left, .. } => {
                !matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma)
                    && left.tag() != ExprTag::PrivateIdentifier
            }
            _ => false,
        }
}

fn is_not_react_component_expression(e: Expr) -> bool {
    is_constant_export_expression(e)
        || !e.is_parenthesized()
            && (e.is_chain_root()
                || match e.kind() {
                    ExprKind::Array(_)
                    | ExprKind::Await(_)
                    | ExprKind::Cond { .. }
                    | ExprKind::Object(_)
                    | ExprKind::This => true,
                    ExprKind::Unary { .. } => true,
                    ExprKind::Binary { op, .. } => matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish),
                    _ => false,
                })
}

impl OnlyExportComponents {
    fn run_once<'a>(&self, cx: &Cx<'a, Self>) {
        let file = cx.file();
        let exports_something = |stmt: Stmt| match stmt.kind() {
            StmtKind::ExportStar { .. } | StmtKind::ExportDefault(_) => true,
            StmtKind::ExportNamed(export) => !export.items().is_empty(),
            _ => stmt.is_default_export() || is_export_declaration(stmt),
        };
        let has_exports = file.body().iter().any(exports_something);
        let mut analysis = ExportAnalysis::default();
        if has_exports {
            for stmt in module_items(file) {
                self.analyze_export(stmt, &mut analysis, cx);
            }
        }
        if has_exports && analysis.has_react_export {
            for span in analysis.non_component_exports {
                cx.report(span, NAMED_EXPORT_COMPONENTS);
            }
            for span in analysis.react_context_exports {
                cx.report(span, REACT_CONTEXT);
            }
            return;
        }
        let message = if has_exports { LOCAL_COMPONENTS } else { NO_EXPORT };
        // What is in an `export`.
        let mut exported = AncestorMemo::default();
        let mut is_exported = |node: Node<'a>| {
            let is_export = |node: Node| {
                matches!(node, Node::Stmt(it)
                    if it.is_exported() || matches!(it.tag(), StmtTag::ExportDefault | StmtTag::ExportNamed))
            };
            exported.find(node, |child, _| is_export(child).then_some(())).is_some()
        };
        for declaration in file.stmts_of_kind(StmtTag::Var) {
            let StmtKind::Var(declarators) = declaration.kind() else {
                continue;
            };
            // The first of a declaration.
            let is_component = |it: &VarDecl| {
                it.pat().as_ident().is_some_and(|name| is_react_component_name(name.bytes()))
                    && self.can_be_react_function_component(it.init())
            };
            if let Some(declarator) = declarators.iter().find(is_component)
                && !is_exported(Node::Stmt(declaration))
            {
                cx.report(declarator.pat().span(), message);
            }
        }
        for func in file.funcs().filter(|it| matches!(it.kind(), FnKind::Decl | FnKind::Expr)) {
            if let Some(id) = func.name().filter(|id| is_react_component_name(id.bytes()))
                && !is_exported(Node::Func(func))
            {
                cx.report(id.span(), message);
            }
        }
    }

    fn is_react_hoc(&self, name: Name) -> bool {
        name.is_any(&["memo", "forwardRef", "lazy"]) || self.custom_hocs.iter().any(|it| **it == *name.bytes())
    }

    fn can_be_react_function_component(&self, init: Option<Expr>) -> bool {
        init.is_some_and(|raw_init| {
            if self.allow_compound_components
                && let ExprKind::Object(properties) = get_inner_expression(raw_init).kind()
            {
                return self.is_compound_component(properties);
            }
            let js_init = skip_ts_expression(raw_init);
            is_arrow_function_expression(js_init)
                || as_call_expression(js_init)
                    .and_then(|it| as_identifier(it.callee()))
                    .is_some_and(|it| self.is_react_hoc(it))
        })
    }

    /// `{ Root, Label: () => <a /> }`: every property is a component.
    fn is_compound_component<'a>(&self, properties: List<'a, Prop<'a>>) -> bool {
        !properties.is_empty()
            && properties.iter().all(|property| {
                // A function without a name gets that of the property.
                let has_component_name = matches!(property.key().map(Key::kind),
                    Some(KeyKind::Ident(name) | KeyKind::String(name)) if is_react_component_name(name.bytes()));
                matches!(property.kind(), PropKind::Init | PropKind::Shorthand | PropKind::Method)
                    && property.value().is_some_and(|it| self.is_compound_component_value(it, has_component_name))
            })
    }

    fn is_compound_component_value(&self, expr: Expr, has_component_name: bool) -> bool {
        let takes_props_and_ref = |func: Func| func.params().len() <= 2;
        // All of these have to be components.
        let mut pending: SmallVec<[Expr; 4]> = smallvec![expr];
        while let Some(expr) = pending.pop().map(get_inner_expression) {
            let is_component = !expr.is_chain_root()
                && match expr.kind() {
                    ExprKind::Ident(name) => is_react_component_name(name.bytes()),
                    ExprKind::Dot { name, .. } => !expr.is_private_member() && is_react_component_name(name.bytes()),
                    ExprKind::Fn(func) if func.is_arrow() => takes_props_and_ref(func) && has_component_name,
                    ExprKind::Fn(func) => {
                        func.has_body()
                            && takes_props_and_ref(func)
                            && func.name().map_or(has_component_name, |id| is_react_component_name(id.bytes()))
                    }
                    ExprKind::Cond { yes, no, .. } => {
                        pending.extend([yes, no]);
                        true
                    }
                    ExprKind::Call(call) => {
                        let callee = call.callee();
                        // What these two are called with is the component.
                        let validate_argument = match plain(callee).map(Expr::kind) {
                            Some(ExprKind::Ident(name)) => name.is_any(&["memo", "forwardRef"]),
                            Some(ExprKind::Dot { name, .. }) => name.name().is_any(&["memo", "forwardRef"]),
                            _ => false,
                        };
                        let argument = call.args().first().filter(|it| it.tag() != ExprTag::Spread);
                        pending.extend(argument.filter(|_| validate_argument));
                        self.is_callee_hoc(callee) && (!validate_argument || argument.is_some())
                    }
                    ExprKind::TaggedTemplate(tagged) => has_component_name && self.is_callee_hoc(tagged.callee()),
                    _ => false,
                };
            if !is_component {
                return false;
            }
        }
        true
    }

    fn analyze_export<'a>(&self, stmt: Stmt<'a>, analysis: &mut ExportAnalysis, cx: &Cx<'a, Self>) {
        let class_export = |class: Class<'a>, id: Ident<'a>| {
            if is_react_component_name(id.bytes()) && is_es6_component(Node::Class(class)) {
                ExportType::ReactComponent
            } else {
                ExportType::NonComponent(id.span())
            }
        };
        match stmt.kind() {
            StmtKind::ExportStar { type_only: false, .. } => drop(cx.report(stmt, EXPORT_ALL_COMPONENTS)),
            StmtKind::ExportDefault(declaration) => {
                let (expr, object) = (skip_ts_expression(declaration), get_inner_expression(declaration));
                if self.allow_compound_components
                    && let ExprKind::Object(properties) = object.kind()
                {
                    analysis.add_export(match self.is_compound_component(properties) {
                        true => ExportType::ReactComponent,
                        false => ExportType::NonComponent(object.span()),
                    });
                } else if as_call_expression(expr).is_some_and(|it| self.is_hoc_call_expression(it)) {
                    analysis.has_react_export = true;
                } else if let Some(name) = as_identifier(expr) {
                    analysis.add_export(self.classify_export_reference(Some(cx.file()), name, name, expr.span()));
                } else {
                    cx.report(stmt, ANONYMOUS_COMPONENTS);
                }
            }
            StmtKind::ExportNamed(export) if !export.is_type_only() => {
                for export_spec in export.items() {
                    let (exported, local) = (export_spec.exported(), export_spec.local());
                    analysis.add_export(if exported.is_string() {
                        ExportType::NonComponent(local.span())
                    } else {
                        let name = if exported.name().is("default") { local } else { exported };
                        let file = (!export.has_from()).then(|| cx.file());
                        self.classify_export_reference(file, name.name(), local.name(), local.span())
                    });
                }
            }
            kind if stmt.is_default_export() => match kind {
                StmtKind::Fn(func) => match func.name() {
                    Some(id) => analysis.add_export(self.classify_export(id.bytes(), id.span(), true, None)),
                    None => drop(cx.report(func.estree_span(), ANONYMOUS_COMPONENTS)),
                },
                StmtKind::Class(class) => match class.name() {
                    Some(id) => analysis.add_export(class_export(class, id)),
                    None => drop(cx.report(class.estree_span(), ANONYMOUS_COMPONENTS)),
                },
                _ => {}
            },
            kind if is_export_declaration(stmt) => match kind {
                StmtKind::Var(declarators) => {
                    for declarator in declarators {
                        let (id, init) = (declarator.pat(), declarator.init());
                        analysis.add_export(match id.as_ident() {
                            Some(name) => self.classify_export(
                                name.bytes(),
                                id.span(),
                                self.can_be_react_function_component(init),
                                init,
                            ),
                            None => ExportType::NonComponent(id.span()),
                        });
                    }
                }
                StmtKind::Fn(func) => {
                    if let Some(id) = func.name() {
                        analysis.add_export(self.classify_export(id.bytes(), id.span(), true, None));
                    }
                }
                StmtKind::Class(class) => {
                    if let Some(id) = class.name() {
                        analysis.add_export(class_export(class, id));
                    }
                }
                StmtKind::Enum(ts_enum) => analysis.add_export(ExportType::NonComponent(ts_enum.name().span())),
                _ => {}
            },
            _ => {}
        }
    }

    /// `file`: where `local_name` is declared. An object that it is declared with counts.
    fn classify_export_reference<'a>(
        &self,
        file: Option<&'a File<'a>>,
        name: Name<'a>,
        local_name: Name<'a>,
        span: Span,
    ) -> ExportType {
        let declarator = file.and_then(|file| {
            match file.top_level_scope().get_name(local_name)?.declarations().next()?.node()? {
                Node::VarDecl(declarator) => Some(declarator).filter(|it| it.pat().as_ident().is_some()),
                _ => None,
            }
        });
        let init = declarator
            .and_then(VarDecl::init)
            .map(get_inner_expression)
            .filter(|it| it.tag() == ExprTag::Object);
        self.classify_export(name.bytes(), span, self.can_be_react_function_component(init), init)
    }

    fn classify_export(&self, name: &[u8], span: Span, is_function: bool, init: Option<Expr>) -> ExportType {
        let by_name =
            || if is_react_component_name(name) { ExportType::ReactComponent } else { ExportType::NonComponent(span) };
        let is_object = init.is_some_and(|it| get_inner_expression(it).tag() == ExprTag::Object);
        let init = init.map(skip_ts_expression);
        let call_expr = init.and_then(as_call_expression);
        if is_react_component_name(name)
            && (call_expr.is_some_and(|it| self.is_callee_hoc(it.callee()) && !it.args().is_empty())
                || matches!(init.and_then(plain).map(Expr::kind), Some(ExprKind::Cond { yes, no, .. })
                    if self.is_react_component_initializer(yes) && self.is_react_component_initializer(no)))
        {
            return ExportType::ReactComponent;
        }
        if self.allow_export_names.iter().any(|it| **it == *name)
            || self.allow_constant_export && init.is_some_and(is_constant_export_expression)
        {
            return ExportType::Allowed;
        }
        if is_function {
            return by_name();
        }
        if is_object {
            return ExportType::NonComponent(span);
        }
        if let Some(call_expr) = call_expr {
            let is_create_context = plain(call_expr.callee()).is_some_and(|callee| match callee.kind() {
                ExprKind::Ident(name) => name.is("createContext"),
                ExprKind::Dot { name, .. } => name.name().is("createContext"),
                _ => false,
            });
            return if is_create_context { ExportType::ReactContext(span) } else { ExportType::NonComponent(span) };
        }
        if init.is_some_and(is_not_react_component_expression) {
            return ExportType::NonComponent(span);
        }
        by_name()
    }

    fn is_react_component_initializer(&self, expr: Expr) -> bool {
        let expr = skip_ts_expression(expr);
        is_arrow_function_expression(expr)
            || is_named_function_expression(expr)
            || as_identifier(expr).is_some_and(|it| is_react_component_name(it.bytes()))
            || as_call_expression(expr).is_some_and(|it| self.is_callee_hoc(it.callee()) && !it.args().is_empty())
    }

    /// `memo`, `React.memo`, `memo.a`, `connect(..)`, and what is called or taken from the result of calling one of
    /// them.
    fn is_callee_hoc(&self, callee: Expr) -> bool {
        let mut callee = callee;
        while let Some(at) = plain(callee) {
            callee = match at.kind() {
                ExprKind::Call(inner_call) => {
                    if as_identifier(inner_call.callee()).is_some_and(|it| it.is("connect")) {
                        return true;
                    }
                    inner_call.callee()
                }
                ExprKind::Dot { obj, name, .. } if !at.is_private_member() => {
                    if self.is_react_hoc(name.name()) || as_identifier(obj).is_some_and(|it| self.is_react_hoc(it)) {
                        return true;
                    }
                    match as_call_expression(obj) {
                        Some(call_expr) => call_expr.callee(),
                        None => return false,
                    }
                }
                ExprKind::Ident(name) => return self.is_react_hoc(name),
                _ => return false,
            };
        }
        false
    }

    /// `memo(A)`, `memo(function A() {})`, `memo(forwardRef(A))`
    fn is_hoc_call_expression(&self, call_expr: Call) -> bool {
        let mut call_expr = call_expr;
        loop {
            let Some(expr) =
                call_expr.args().first().filter(|_| self.is_callee_hoc(call_expr.callee())).map(skip_ts_expression)
            else {
                return false;
            };
            match as_call_expression(expr) {
                Some(inner_call) => call_expr = inner_call,
                None => return as_identifier(expr).is_some() || is_named_function_expression(expr),
            }
        }
    }
}
