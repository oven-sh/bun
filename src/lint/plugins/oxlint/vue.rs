//! oxlint's `utils/vue.rs` and `utils/this_expression.rs`.
//!
//! oxlint lints the scripts of a `.vue` file, each as a program of its own, and knows nothing of the template.

use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint_oxlint::ast_util::{
    as_object_expression, as_object_property, get_inner_expression, get_member_expr,
    is_specific_id, iter_outer_expressions, parent_node, static_name, static_property_name,
};
use bun_lint_oxlint::import::{
    ImportEntry, ImportImportName, import_entries, is_export_declaration,
    is_type_export_declaration,
};
use rustc_hash::{FxHashMap, FxHashSet};
use std::cell::Cell;
use std::rc::Rc;

/// `ctx.file_extension().is_some_and(|ext| ext == "vue")`
pub(crate) fn is_vue_file(file: &File) -> bool {
    let name = bun_lint::paths::file_name(file.path());
    name.len() > 4 && name.ends_with(b".vue")
}

/// `ctx.frameworks_options() == FrameworkOptions::VueSetup`: the script is a `<script setup>`.
pub(crate) fn is_vue_setup(file: &File) -> bool {
    file.vue_script().is_setup
}

/// The same of `e.get_inner_expression()`.
pub(crate) fn as_inner_object_expression(e: Expr<'_>) -> Option<List<'_, Prop<'_>>> {
    match get_inner_expression(e).kind() {
        ExprKind::Object(properties) => Some(properties),
        _ => None,
    }
}

/// The `ObjectPropertyKind::ObjectProperty` among `properties`: all but `...a`.
pub(crate) fn object_properties<'a>(
    properties: List<'a, Prop<'a>>,
) -> impl Iterator<Item = Prop<'a>> {
    properties.iter().filter(|it| it.kind() != PropKind::Spread)
}

/// `prop.key.static_name()`
pub(crate) fn key_name(prop: Prop<'_>) -> Option<Name<'_>> {
    prop.key().and_then(static_name)
}

/// `prop.key.is_specific_static_name(name)`
pub(crate) fn is_specific_static_name(prop: Prop, name: &str) -> bool {
    key_name(prop).is_some_and(|it| it.is(name))
}

/// `key.span()`: without the brackets around a computed key.
pub(crate) fn span_of_key<'a>(key: Key<'a>, file: &File<'a>) -> Span {
    let span = key.span(file);
    match key.kind() {
        KeyKind::Computed(e) => e.outer_span(),
        KeyKind::ComputedString(_) | KeyKind::ComputedNumber(_) => Span::new(
            skip_trivia(file.text(), span.start + 1),
            skip_trivia_back(file.text(), span.end.saturating_sub(1)),
        ),
        _ => span,
    }
}

/// `prop.key.span()`
pub(crate) fn key_span(prop: Prop) -> Span {
    prop.key()
        .map_or_else(|| prop.span(), |key| span_of_key(key, prop.file()))
}

/// The first property that is named `name`.
pub(crate) fn find_property<'a>(properties: List<'a, Prop<'a>>, name: &str) -> Option<Prop<'a>> {
    object_properties(properties).find(|it| is_specific_static_name(*it, name))
}

/// `ExportDefaultDeclarationKind::ObjectExpression`: the properties of the `{ .. }` of a statement `export default { .. }`.
pub(crate) fn exported_object(stmt: Stmt<'_>) -> Option<List<'_, Prop<'_>>> {
    match stmt.kind() {
        StmtKind::ExportDefault(e) => as_object_expression(e),
        _ => None,
    }
}

/// The properties of the `{ .. }` of `defineComponent({ .. })`, whatever follows it.
pub(crate) fn define_component_object(call: Call<'_>) -> Option<List<'_, Prop<'_>>> {
    call.args()
        .first()
        .filter(|_| is_specific_id(call.callee(), "defineComponent"))
        .and_then(as_object_expression)
}

/// What kind of options of a component an object literal is.
#[derive(Copy, Clone, PartialEq, Eq)]
enum VueComponentObjectKind {
    /// `export default { .. }` in a `.vue` file, not in a `<script setup>`.
    Export,
    /// An argument of `createApp`, `defineComponent`, `Vue.component`, `app.mixin`, ..
    Definition,
    /// `new Vue({ .. })`
    Instance,
}

/// `object`: an object literal.
fn vue_component_options_kind(object: Expr) -> Option<VueComponentObjectKind> {
    match parent_node(object)? {
        Node::Stmt(stmt) if stmt.tag() == StmtTag::ExportDefault => (is_vue_file(object.file())
            && !is_vue_setup(object.file()))
        .then_some(VueComponentObjectKind::Export),
        Node::Expr(parent) => match parent.kind() {
            ExprKind::Call(call)
                if call.args().last() == Some(object) && is_vue_component_options_call(call) =>
            {
                Some(VueComponentObjectKind::Definition)
            }
            ExprKind::New(new)
                if new.args().first() == Some(object) && is_specific_id(new.callee(), "Vue") =>
            {
                Some(VueComponentObjectKind::Instance)
            }
            _ => None,
        },
        _ => None,
    }
}

pub(crate) fn is_vue_component_options_object(object: Expr) -> bool {
    object.tag() == ExprTag::Object && vue_component_options_kind(object).is_some()
}

/// Not `new Vue({ .. })`.
pub(crate) fn is_vue_component_options_object_excluding_instance(object: Expr) -> bool {
    object.tag() == ExprTag::Object
        && matches!(
            vue_component_options_kind(object),
            Some(VueComponentObjectKind::Export | VueComponentObjectKind::Definition)
        )
}

/// `createApp(..)`, `defineComponent(..)`, `defineNuxtComponent(..)`, `component(..)`, `Vue.component(..)`, `Vue.mixin(..)`,
/// `Vue.extend(..)`, `app.component(..)`, `app.mixin(..)`
fn is_vue_component_options_call(call: Call) -> bool {
    if let Some(name) = get_inner_expression(call.callee()).as_ident() {
        return name.is_any(&[
            "createApp",
            "defineComponent",
            "defineNuxtComponent",
            "component",
        ]);
    }
    let Some(member_expr) = get_member_expr(call.callee()) else {
        return false;
    };
    static_property_name(member_expr).is_some_and(|prop_name| {
        prop_name.is_any(&["component", "mixin"])
            || prop_name.is("extend")
                && member_expr
                    .object()
                    .is_some_and(|it| is_specific_id(it, "Vue"))
    })
}

/// The property of an object literal that `e` is the value or the computed key of.
pub(crate) fn parent_object_property(e: Expr<'_>) -> Option<Prop<'_>> {
    parent_node(e).and_then(as_object_property)
}

/// The object literal that `prop` is a property of.
pub(crate) fn object_of(prop: Prop<'_>) -> Option<Expr<'_>> {
    prop.parent().as_expr()
}

/// `vm` after `const vm = this`.
fn is_this_alias(ident: Expr) -> bool {
    let Some(Declaration::Var(id)) = ident.symbol().and_then(|it| it.declarations().next()) else {
        return false;
    };
    matches!(id.parent(), Node::VarDecl(var) if var.var_kind() == VarKind::Const
        && var.init().is_some_and(|init| get_inner_expression(init).tag() == ExprTag::This))
}

pub(crate) fn is_this_object(expr: Expr) -> bool {
    let expr = get_inner_expression(expr);
    expr.tag() == ExprTag::This || expr.tag() == ExprTag::Ident && is_this_alias(expr)
}

/// What is asked about the functions around a node.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Enclosing {
    /// `AstKind::Function`: the function that `this` belongs to.
    Function,
    /// `AstKind::Function | AstKind::ArrowFunctionExpression`
    FunctionOrArrow,
}

/// The innermost function around a node. One for each [`Enclosing`].
pub(crate) type EnclosingFunctions<'a> = AncestorMemo<'a, Func<'a>>;

pub(crate) fn enclosing_function<'a>(
    node: Node<'a>,
    which: Enclosing,
    memo: &mut EnclosingFunctions<'a>,
) -> Option<Func<'a>> {
    memo.find(node, |_, parent| {
        parent.as_func().filter(|it| {
            it.kind() != FnKind::StaticBlock
                && (which == Enclosing::FunctionOrArrow || !it.is_arrow())
        })
    })
}

/// The property that the function expression `func` is the value of.
pub(crate) fn property_of_function(func: Func<'_>) -> Option<Prop<'_>> {
    func.owner().as_expr().and_then(parent_object_property)
}

/// `node` is in a method of the options of a component (`mounted() {}`), or of their `methods`, `computed` or `watch`.
/// `memo`: for [`Enclosing::Function`].
pub(crate) fn is_in_vue_component_instance_method<'a>(
    node: Expr<'a>,
    memo: &mut EnclosingFunctions<'a>,
) -> bool {
    let function = enclosing_function(Node::Expr(node), Enclosing::Function, memo);
    let Some(object) = function.and_then(property_of_function).and_then(object_of) else {
        return false;
    };
    is_vue_component_options_object(object)
        || parent_object_property(object).is_some_and(|container| {
            container.key().is_some_and(|key| !key.is_computed())
                && key_name(container)
                    .is_some_and(|it| it.is_any(&["computed", "methods", "watch"]))
                && object_of(container).is_some_and(is_vue_component_options_object)
        })
}

/// An entry of `local_export_entries`, `indirect_export_entries` or `star_export_entries` of oxc's `ModuleRecord`.
pub(crate) struct ExportEntry<'a> {
    /// The specifier, the declaration without its `export`, or the whole of an `export *`.
    pub(crate) span: Span,
    pub(crate) is_type: bool,
    /// The module that it comes from, and where that is written: for an `export { a }` of what is imported, in the `import`.
    pub(crate) module_request: Option<(Name<'a>, Span)>,
}

/// The first import of each name.
fn first_imports<'a>(file: &'a File<'a>) -> FxHashMap<Name<'a>, ImportEntry<'a>> {
    let mut first = FxHashMap::default();
    for entry in import_entries(file) {
        first.entry(entry.local_name().name()).or_insert(entry);
    }
    first
}

pub(crate) fn export_entries<'a>(file: &'a File<'a>) -> Vec<ExportEntry<'a>> {
    let mut entries = Vec::new();
    let mut imported: Option<FxHashMap<Name<'a>, ImportEntry<'a>>> = None;
    for stmt in file.body() {
        let source = |name: Option<Name<'a>>| Some((name?, stmt.module_specifier_span()?));
        match stmt.kind() {
            StmtKind::ExportStar {
                spec, type_only, ..
            } => {
                entries.push(ExportEntry {
                    span: stmt.span(),
                    is_type: type_only,
                    module_request: source(spec),
                });
            }
            StmtKind::ExportDefault(e) => entries.push(ExportEntry {
                span: e.outer_span(),
                is_type: false,
                module_request: None,
            }),
            StmtKind::ExportNamed(export) => {
                let module_request = source(export.spec().filter(|_| export.has_from()));
                for specifier in export.items() {
                    let import = match module_request {
                        None => imported
                            .get_or_insert_with(|| first_imports(file))
                            .get(&specifier.local().name())
                            .copied(),
                        Some(_) => None,
                    };
                    entries.push(
                        match import.filter(|it| {
                            !matches!(it.import_name, ImportImportName::NamespaceObject(_))
                        }) {
                            Some(import) => ExportEntry {
                                span: specifier.span(),
                                is_type: import.is_type(),
                                module_request: import
                                    .declaration
                                    .spec_span()
                                    .map(|span| (import.declaration.spec(), span)),
                            },
                            None => ExportEntry {
                                span: specifier.span(),
                                is_type: specifier.is_type_only() || export.is_type_only(),
                                module_request,
                            },
                        },
                    );
                }
            }
            kind if stmt.is_default_export() => {
                let is_type = match kind {
                    StmtKind::Fn(func) => !func.has_body() || stmt.flags().contains(Flags::AMBIENT),
                    StmtKind::Class(_) => stmt.flags().intersects(Flags::AMBIENT | Flags::ABSTRACT),
                    _ => true,
                };
                entries.push(ExportEntry {
                    span: stmt.span_without_export(),
                    is_type,
                    module_request: None,
                });
            }
            kind if is_export_declaration(stmt) => {
                // One for each name.
                let mut names = 0;
                match kind {
                    StmtKind::Var(declarators) => declarators
                        .iter()
                        .for_each(|it| it.pat().for_each_binding(&mut |_| names += 1)),
                    StmtKind::Module(module) => {
                        names = usize::from(matches!(module.name(), ModuleName::Ident(_)))
                    }
                    StmtKind::Fn(func) => names = usize::from(func.name().is_some()),
                    StmtKind::Class(class) => names = usize::from(class.name().is_some()),
                    _ => names = 1,
                }
                let (span, is_type) =
                    (stmt.span_without_export(), is_type_export_declaration(stmt));
                entries.extend((0..names).map(|_| ExportEntry {
                    span,
                    is_type,
                    module_request: None,
                }));
            }
            _ => {}
        }
    }
    entries
}

/// The function, with a body, that is the `setup` of the options of a component.
pub(crate) fn setup_function<'a>(properties: List<'a, Prop<'a>>) -> Option<Func<'a>> {
    let value = find_property(properties, "setup")?.value()?;
    value
        .as_fn()
        .filter(|it| !value.is_parenthesized() && it.has_body())
}

/// The `setup` of each `export default { .. }` and `defineComponent({ .. })` of the file.
pub(crate) fn setup_functions<'a>(file: &'a File<'a>) -> FxHashSet<Func<'a>> {
    let exported = file
        .stmts_of_kind(StmtTag::ExportDefault)
        .filter_map(exported_object);
    let calls = file
        .mentions("defineComponent")
        .then(|| file.exprs_of_kind(ExprTag::Call))
        .into_iter()
        .flatten();
    let defined = calls.filter_map(|it| it.as_call().and_then(define_component_object));
    exported.chain(defined).filter_map(setup_function).collect()
}

/// The call that the identifier `ident` is what is called of: `ident()`, `(ident as any)()`.
pub(crate) fn call_of_callee(ident: Expr<'_>) -> Option<Expr<'_>> {
    let call = iter_outer_expressions(ident).next()?.as_expr()?;
    call.as_call()
        .filter(|it| get_inner_expression(it.callee()) == ident)
        .map(|_| call)
}

/// The variable of the file that an `import` declares.
fn symbol_of_import<'a>(entry: &ImportEntry<'a>) -> Option<Symbol<'a>> {
    Node::Stmt(entry.declaration.stmt())
        .scope()
        .get_name(entry.local_name().name())
}

/// The variables that are imported from `vue` under one of `names`, with these names.
pub(crate) fn imported_from_vue<'a>(
    file: &'a File<'a>,
    names: &'static [&'static str],
) -> impl Iterator<Item = (Symbol<'a>, Name<'a>)> {
    // No value refers to what `import type` declares.
    let entries =
        import_entries(file).filter(|it| it.declaration.spec().is("vue") && !it.is_type());
    entries.filter_map(move |entry| match entry.import_name {
        ImportImportName::Name(specifier) if specifier.imported().name().is_any(names) => {
            // Once, if the name is declared several times.
            let is_first = |it: &Symbol<'a>| {
                matches!(it.declarations().next(), Some(Declaration::ImportSpec(first)) if first == specifier)
            };
            Some((symbol_of_import(&entry).filter(is_first)?, specifier.imported().name()))
        }
        _ => None,
    })
}

/// What the visitors of oxlint see that go through the body of a function in the order of the source, but neither into other
/// functions nor into what is awaited, and look for what comes after the first `await`. For all the functions of a file.
pub struct AfterAwait<'a> {
    /// The function whose visitor comes to a node, if there is one.
    visitor: AncestorMemo<'a, Option<Func<'a>>>,
    /// Where the first `await` starts that the visitor of a function comes to.
    first_await: FxHashMap<Func<'a>, u32>,
}

impl<'a> AfterAwait<'a> {
    pub(crate) fn new(file: &'a File<'a>) -> Self {
        let mut this = AfterAwait {
            visitor: AncestorMemo::default(),
            first_await: FxHashMap::default(),
        };
        for awaited in file.exprs_of_kind(ExprTag::Await) {
            if let Some(function) = this.visitor_of(Node::Expr(awaited)) {
                let start = awaited.span().start;
                this.first_await
                    .entry(function)
                    .and_modify(|it| *it = start.min(*it))
                    .or_insert(start);
            }
        }
        this
    }

    fn visitor_of(&mut self, node: Node<'a>) -> Option<Func<'a>> {
        let decide = |child: Node<'a>, parent: Node<'a>| match parent {
            Node::Func(it) if it.kind() != FnKind::StaticBlock => {
                Some((!matches!(child, Node::Param(_))).then_some(it))
            }
            Node::Expr(it) if it.tag() == ExprTag::Await => Some(None),
            _ => None,
        };
        self.visitor.find(node, decide).flatten()
    }

    /// The function whose visitor comes to `node` when it has seen an `await`.
    pub(crate) fn function_of(&mut self, node: Node<'a>) -> Option<Func<'a>> {
        let function = self.visitor_of(node)?;
        self.first_await
            .get(&function)
            .is_some_and(|first| node.span().start > *first)
            .then_some(function)
    }
}

/// Where a getter of a computed property is.
#[derive(Copy, Clone)]
pub(crate) enum ComputedContext<'a> {
    /// `computed: { key() {} }`, `computed: { key: { get() {} } }`: the `key`, if it is known.
    OptionsApi(Option<Name<'a>>),
    /// `computed(fn)`, `computed({ get: fn })`: the function.
    CompositionApi(Func<'a>),
}

/// That of the innermost function around `node`. `memo`: for [`Enclosing::FunctionOrArrow`].
pub(crate) fn find_computed_context<'a>(
    node: Expr<'a>,
    memo: &mut EnclosingFunctions<'a>,
) -> Option<ComputedContext<'a>> {
    enclosing_function(Node::Expr(node), Enclosing::FunctionOrArrow, memo)
        .and_then(get_computed_getter_context)
}

pub(crate) fn get_computed_getter_context(function: Func<'_>) -> Option<ComputedContext<'_>> {
    let is_computed_call = |node: Node| {
        node.as_expr()
            .and_then(Expr::as_call)
            .is_some_and(is_vue_computed_call)
    };
    let is_computed_group = |group: Prop| {
        is_specific_static_name(group, "computed")
            && object_of(group).is_some_and(is_vue_component_options_object)
    };
    let parent = parent_node(function.owner().as_expr()?)?;
    if is_computed_call(parent) {
        return Some(ComputedContext::CompositionApi(function));
    }
    let prop = as_object_property(parent)?;
    let great = parent_node(object_of(prop)?)?;
    match as_object_property(great) {
        Some(outer) if is_specific_static_name(outer, "computed") && !function.is_arrow() => {
            is_computed_group(outer).then(|| ComputedContext::OptionsApi(key_name(prop)))
        }
        Some(key_prop) if is_specific_static_name(prop, "get") && !function.is_arrow() => {
            let group = object_of(key_prop).and_then(parent_object_property)?;
            is_computed_group(group).then(|| ComputedContext::OptionsApi(key_name(key_prop)))
        }
        None if is_specific_static_name(prop, "get") && is_computed_call(great) => {
            Some(ComputedContext::CompositionApi(function))
        }
        _ => None,
    }
}

/// A call of the `computed` of Vue, under whatever name it is imported.
fn is_vue_computed_call(call: Call) -> bool {
    let declaration = get_inner_expression(call.callee())
        .symbol()
        .and_then(|it| it.declarations().next());
    matches!(declaration, Some(Declaration::ImportSpec(specifier))
        if specifier.imported().name().is("computed") && specifier.import().spec().is_any(&["vue", "@vue/composition-api", "#imports"]))
}

/// What `break` and `continue` can go to.
struct JumpTarget<'a> {
    label: Option<Name<'a>>,
    is_loop: bool,
    broke: bool,
    continued: bool,
    /// Where the label of the same name is that is around this one.
    shadowed: Option<usize>,
}

/// Those that it is in, from the outside.
#[derive(Default)]
struct JumpTargets<'a> {
    all: Vec<JumpTarget<'a>>,
    /// Where those without a label are in `all`, where the loops are, and where the innermost label of each name is.
    unlabeled: Vec<usize>,
    loops: Vec<usize>,
    labels: FxHashMap<Name<'a>, usize>,
}

impl<'a> JumpTargets<'a> {
    fn push(&mut self, label: Option<Name<'a>>, is_loop: bool) {
        let at = self.all.len();
        let shadowed = match label {
            Some(label) => self.labels.insert(label, at),
            None => {
                self.unlabeled.push(at);
                None
            }
        };
        if is_loop {
            self.loops.push(at);
        }
        self.all.push(JumpTarget {
            label,
            is_loop,
            broke: false,
            continued: false,
            shadowed,
        });
    }

    fn pop(&mut self) -> Option<JumpTarget<'a>> {
        let target = self.all.pop()?;
        match (target.label, target.shadowed) {
            (Some(label), Some(shadowed)) => {
                self.labels.insert(label, shadowed);
            }
            (Some(label), None) => {
                self.labels.remove(&label);
            }
            (None, _) => {
                self.unlabeled.pop();
            }
        }
        if target.is_loop {
            self.loops.pop();
        }
        Some(target)
    }

    fn of_break(&mut self, label: Option<Name<'a>>) -> Option<&mut JumpTarget<'a>> {
        let at = match label {
            Some(label) => self.labels.get(&label),
            None => self.unlabeled.last(),
        };
        self.all.get_mut(*at?)
    }

    /// The loop that the label is before, or the innermost.
    fn of_continue(&mut self, label: Option<Name<'a>>) -> Option<&mut JumpTarget<'a>> {
        let at = match label.and_then(|it| self.labels.get(&it)) {
            Some(label) => self.loops.get(self.loops.partition_point(|it| it < label)),
            None => self.loops.last(),
        };
        self.all.get_mut(*at?)
    }
}

/// What is left to do in [`definitely_returns_in_all_codepaths`].
enum Step<'a> {
    Stmt(Stmt<'a>),
    /// The statements of a list that are left.
    Rest(ListIter<'a, Stmt<'a>>),
    /// After the `yes` of an `if`.
    Else {
        entry: bool,
        no: Option<Stmt<'a>>,
    },
    /// After the `no` of an `if`.
    EndIf {
        yes: bool,
    },
    /// After the body of a `while`, a `for` or a `with`: what follows can be reached if the statement can.
    EndBody {
        entry: bool,
        is_loop: bool,
    },
    EndDoWhile,
    EndLabeled,
    Case {
        entry: bool,
        case: Case<'a>,
    },
    EndSwitch {
        skips: bool,
    },
    EndTryBlock {
        entry: bool,
        handler: Option<Stmt<'a>>,
        has_finalizer: bool,
    },
    EndCatch {
        block: bool,
        has_finalizer: bool,
    },
}

/// oxlint's `utils/control_flow.rs`: whether execution leaves the function by a `return` or a `throw` on all the paths that oxlint
/// follows through the control flow graph of oxc. `treat_undefined_as_unspecified`: a `return;` is none.
///
/// It is not what ESLint's code paths say:
/// - No condition is looked at: what follows a `while (true) {}` or a `for (;;) {}` can be reached.
/// - It never gets into a `finally`, nor to what follows a `try` that has one: the `try` and the `catch` have to return themselves.
/// - Nothing is asked of what is in a `try` that has a `catch`: from everywhere in there it goes on to the `catch`.
pub(crate) fn definitely_returns_in_all_codepaths(
    function: Func,
    treat_undefined_as_unspecified: bool,
) -> bool {
    let Some(body) = function.body_statements() else {
        return true;
    };
    let mut steps = vec![Step::Rest(body.iter())];
    let mut targets = JumpTargets::default();
    // Whether it gets to where it is, and in how many `try` with a `catch` that is.
    let (mut live, mut explicit_depth) = (true, 0usize);
    while let Some(step) = steps.pop() {
        let stmt = match step {
            Step::Stmt(stmt) => stmt,
            Step::Rest(mut rest) => {
                if let Some(stmt) = rest.next() {
                    steps.extend([Step::Rest(rest), Step::Stmt(stmt)]);
                }
                continue;
            }
            Step::Else { entry, no } => {
                steps.push(Step::EndIf { yes: live });
                steps.extend(no.map(Step::Stmt));
                live = entry;
                continue;
            }
            Step::EndIf { yes } => {
                live |= yes;
                continue;
            }
            Step::EndBody { entry, is_loop } => {
                if is_loop {
                    targets.pop();
                }
                live = entry;
                continue;
            }
            Step::EndDoWhile => {
                let target = targets.pop();
                live = target.is_some_and(|it| it.broke || it.continued) || live;
                continue;
            }
            Step::EndLabeled => {
                live |= targets.pop().is_some_and(|it| it.broke);
                continue;
            }
            Step::Case { entry, case } => {
                live |= entry;
                steps.push(Step::Rest(case.body().iter()));
                continue;
            }
            Step::EndSwitch { skips } => {
                live |= targets.pop().is_some_and(|it| it.broke) || skips;
                continue;
            }
            Step::EndTryBlock {
                entry,
                handler: Some(handler),
                has_finalizer,
            } => {
                explicit_depth -= 1;
                steps.extend([
                    Step::EndCatch {
                        block: live,
                        has_finalizer,
                    },
                    Step::Stmt(handler),
                ]);
                live = entry;
                continue;
            }
            Step::EndTryBlock { handler: None, .. }
            | Step::EndCatch {
                has_finalizer: true,
                ..
            } => {
                if live && explicit_depth == 0 {
                    return false;
                }
                live = false;
                continue;
            }
            Step::EndCatch {
                block,
                has_finalizer: false,
            } => {
                live |= block;
                continue;
            }
        };
        match stmt.kind() {
            StmtKind::Block(list) => steps.push(Step::Rest(list.iter())),
            StmtKind::If { yes, no, .. } => {
                steps.extend([Step::Else { entry: live, no }, Step::Stmt(yes)])
            }
            StmtKind::While { body, .. }
            | StmtKind::For { body, .. }
            | StmtKind::ForIn { body, .. }
            | StmtKind::ForOf { body, .. } => {
                targets.push(None, true);
                steps.extend([
                    Step::EndBody {
                        entry: live,
                        is_loop: true,
                    },
                    Step::Stmt(body),
                ]);
            }
            StmtKind::With { body, .. } => steps.extend([
                Step::EndBody {
                    entry: live,
                    is_loop: false,
                },
                Step::Stmt(body),
            ]),
            StmtKind::DoWhile { body, .. } => {
                targets.push(None, true);
                steps.extend([Step::EndDoWhile, Step::Stmt(body)]);
            }
            StmtKind::Labeled { label, body } => {
                targets.push(Some(label), false);
                steps.extend([Step::EndLabeled, Step::Stmt(body)]);
            }
            StmtKind::Switch { cases, .. } => {
                targets.push(None, false);
                steps.push(Step::EndSwitch {
                    skips: live && !cases.iter().any(Case::is_default),
                });
                steps.extend(
                    cases
                        .iter()
                        .rev()
                        .map(|case| Step::Case { entry: live, case }),
                );
                live = false;
            }
            StmtKind::Try {
                block,
                handler,
                finalizer,
                ..
            } => {
                explicit_depth += usize::from(handler.is_some());
                steps.extend([
                    Step::EndTryBlock {
                        entry: live,
                        handler,
                        has_finalizer: finalizer.is_some(),
                    },
                    Step::Stmt(block),
                ]);
            }
            StmtKind::Return(argument) => {
                if live
                    && explicit_depth == 0
                    && argument.is_none()
                    && treat_undefined_as_unspecified
                {
                    return false;
                }
                live = false;
            }
            StmtKind::Throw(_) => live = false,
            StmtKind::Break(label) => {
                if let Some(found) = targets.of_break(label).filter(|_| live) {
                    found.broke = true;
                }
                live = false;
            }
            StmtKind::Continue(label) => {
                if let Some(found) = targets.of_continue(label).filter(|_| live) {
                    found.continued = true;
                }
                live = false;
            }
            _ => {}
        }
    }
    !live
}

/// The names of `eslint-plugin-vue`'s `vue/no-reserved-component-names`.
/// Sorted.
pub(crate) const VUE_RESERVED_HTML_ELEMENTS: [&str; 115] = [
    "a",
    "abbr",
    "address",
    "area",
    "article",
    "aside",
    "audio",
    "b",
    "base",
    "bdi",
    "bdo",
    "blockquote",
    "body",
    "br",
    "button",
    "canvas",
    "caption",
    "cite",
    "code",
    "col",
    "colgroup",
    "data",
    "datalist",
    "dd",
    "del",
    "details",
    "dfn",
    "dialog",
    "div",
    "dl",
    "dt",
    "em",
    "embed",
    "fencedframe",
    "fieldset",
    "figcaption",
    "figure",
    "footer",
    "form",
    "geolocation",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "head",
    "header",
    "hgroup",
    "hr",
    "html",
    "i",
    "iframe",
    "img",
    "input",
    "ins",
    "kbd",
    "label",
    "legend",
    "li",
    "link",
    "main",
    "map",
    "mark",
    "menu",
    "meta",
    "meter",
    "nav",
    "noscript",
    "object",
    "ol",
    "optgroup",
    "option",
    "output",
    "p",
    "picture",
    "pre",
    "progress",
    "q",
    "rp",
    "rt",
    "ruby",
    "s",
    "samp",
    "script",
    "search",
    "section",
    "select",
    "selectedcontent",
    "slot",
    "small",
    "source",
    "span",
    "strong",
    "style",
    "sub",
    "summary",
    "sup",
    "table",
    "tbody",
    "td",
    "template",
    "textarea",
    "tfoot",
    "th",
    "thead",
    "time",
    "title",
    "tr",
    "track",
    "u",
    "ul",
    "var",
    "video",
    "wbr",
];

/// Sorted.
pub(crate) const VUE_RESERVED_DEPRECATED_HTML_ELEMENTS: [&str; 29] = [
    "acronym",
    "applet",
    "basefont",
    "bgsound",
    "big",
    "blink",
    "center",
    "dir",
    "font",
    "frame",
    "frameset",
    "isindex",
    "keygen",
    "listing",
    "marquee",
    "menuitem",
    "multicol",
    "nextid",
    "nobr",
    "noembed",
    "noframes",
    "param",
    "plaintext",
    "rb",
    "rtc",
    "spacer",
    "strike",
    "tt",
    "xmp",
];

/// Sorted.
pub(crate) const VUE_RESERVED_SVG_ELEMENTS: [&str; 63] = [
    "a",
    "animate",
    "animateMotion",
    "animateTransform",
    "circle",
    "clipPath",
    "defs",
    "desc",
    "ellipse",
    "feBlend",
    "feColorMatrix",
    "feComponentTransfer",
    "feComposite",
    "feConvolveMatrix",
    "feDiffuseLighting",
    "feDisplacementMap",
    "feDistantLight",
    "feDropShadow",
    "feFlood",
    "feFuncA",
    "feFuncB",
    "feFuncG",
    "feFuncR",
    "feGaussianBlur",
    "feImage",
    "feMerge",
    "feMergeNode",
    "feMorphology",
    "feOffset",
    "fePointLight",
    "feSpecularLighting",
    "feSpotLight",
    "feTile",
    "feTurbulence",
    "filter",
    "foreignObject",
    "g",
    "image",
    "line",
    "linearGradient",
    "marker",
    "mask",
    "metadata",
    "mpath",
    "path",
    "pattern",
    "polygon",
    "polyline",
    "radialGradient",
    "rect",
    "script",
    "set",
    "stop",
    "style",
    "svg",
    "switch",
    "symbol",
    "text",
    "textPath",
    "title",
    "tspan",
    "use",
    "view",
];

/// Sorted.
pub(crate) const VUE_RESERVED_KEBAB_CASE_ELEMENTS: [&str; 8] = [
    "annotation-xml",
    "color-profile",
    "font-face",
    "font-face-format",
    "font-face-name",
    "font-face-src",
    "font-face-uri",
    "missing-glyph",
];

/// Sorted.
pub(crate) const VUE2_BUILTIN_COMPONENT_NAMES: [&str; 10] = [
    "Component",
    "KeepAlive",
    "Transition",
    "TransitionGroup",
    "component",
    "keep-alive",
    "slot",
    "template",
    "transition",
    "transition-group",
];

/// Sorted.
pub(crate) const VUE3_BUILTIN_COMPONENT_NAMES_EXTRA: [&str; 4] =
    ["Suspense", "Teleport", "suspense", "teleport"];

/// How many members of interfaces and type aliases a rule still looks at in a file. A name can stand for them any number of times,
/// `defineProps<A & A>(); defineProps<A>()`, so that there is no end to it in proportion to the file. The state of a rule.
pub struct NamedTypeBudget(Cell<u32>);

impl Default for NamedTypeBudget {
    fn default() -> Self {
        NamedTypeBudget(Cell::new(1 << 20))
    }
}

impl NamedTypeBudget {
    fn spend(&self) -> bool {
        let left = self.0.get();
        self.0.set(left.saturating_sub(1));
        left > 0
    }
}

/// Calls `f` with every member of the type literals and interfaces that the `T` of `defineProps<T>()` is made of: it goes through
/// unions, intersections and the names of interfaces and type aliases. Each alias is looked at once.
pub(crate) fn for_each_define_props_type_signature<'a>(
    ts_type: TypeNode<'a>,
    budget: &NamedTypeBudget,
    f: &mut dyn FnMut(Member<'a>),
) {
    // With whether a name stands for it.
    let mut pending = vec![(ts_type, false)];
    let mut seen: FxHashSet<TypeNode<'a>> = FxHashSet::default();
    while let Some((ts_type, is_named)) = pending.pop() {
        match ts_type.kind() {
            _ if ts_type.is_parenthesized() => {}
            TypeKind::Object(members) => members
                .iter()
                .take_while(|_| !is_named || budget.spend())
                .for_each(&mut *f),
            TypeKind::Union(types) | TypeKind::Intersection(types) => {
                pending.extend(types.iter().rev().map(|it| (it, is_named)))
            }
            TypeKind::Ref { name, .. } if name.len() == 1 => {
                let reference = name
                    .first()
                    .and_then(|it| ts_type.file().reference_at(it.span().start));
                match reference
                    .filter(|it| it.is_type())
                    .and_then(|it| it.symbol()?.declarations().next())
                {
                    Some(Declaration::Interface(interface)) => {
                        interface
                            .members()
                            .iter()
                            .take_while(|_| budget.spend())
                            .for_each(&mut *f);
                    }
                    Some(Declaration::TypeAlias(alias)) if seen.insert(alias.ty()) => {
                        pending.push((alias.ty(), true))
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }
}

/// The key of a `TSPropertySignature` or a `TSMethodSignature`.
pub(crate) fn signature_key(signature: Member<'_>) -> Option<Key<'_>> {
    let is_named = matches!(
        signature.kind(),
        MemberKind::Property | MemberKind::Method | MemberKind::Getter | MemberKind::Setter
    );
    signature.key().filter(|_| is_named)
}

/// The `T` of `call<T>()`.
pub(crate) fn first_type_argument(call: Call<'_>) -> Option<TypeNode<'_>> {
    call.type_args().first()
}

/// oxlint's `utils/vue_casing.rs`, which is `eslint-plugin-vue`'s `utils/casing.js`.
pub(crate) mod casing {
    use bun_core::strings;
    use bun_lint::prelude::text;

    /// There is a character that no casing allows.
    fn has_symbols(s: &[u8]) -> bool {
        strings::index_of_any(s, b"!\"#%&'()*+,./:;<=>?@[\\]^`{|}").is_some()
    }

    fn has_upper(s: &[u8]) -> bool {
        s.iter().any(u8::is_ascii_uppercase)
    }

    fn has_white_space(s: &[u8]) -> bool {
        (0..s.len()).any(|at| strings::js_whitespace_len(s.get(at..).unwrap_or_default()) > 0)
    }

    fn has_separator(s: &[u8]) -> bool {
        strings::index_of_any(s, b"-_").is_some() || has_white_space(s)
    }

    pub(crate) fn is_pascal_case(s: &[u8]) -> bool {
        !has_symbols(s) && !s.first().is_some_and(u8::is_ascii_lowercase) && !has_separator(s)
    }

    pub(crate) fn is_kebab_case(s: &[u8]) -> bool {
        !has_upper(s)
            && !has_symbols(s)
            && !s.starts_with(b"-")
            && !strings::contains_char(s, b'_')
            && !strings::contains(s, b"--")
            && !has_white_space(s)
    }

    pub(crate) fn is_camel_case(s: &[u8]) -> bool {
        !has_symbols(s) && !s.first().is_some_and(u8::is_ascii_uppercase) && !has_separator(s)
    }

    pub(crate) fn is_snake_case(s: &[u8]) -> bool {
        !has_upper(s)
            && !has_symbols(s)
            && !strings::contains_char(s, b'-')
            && !strings::contains(s, b"__")
            && !has_white_space(s)
    }

    /// `\w`
    fn is_regex_word(c: u8) -> bool {
        c.is_ascii_alphanumeric() || c == b'_'
    }

    /// `s` with `change` of its first character.
    fn with_first(s: &[u8], change: fn(&str) -> String) -> Vec<u8> {
        let first = s
            .utf8_chunks()
            .next()
            .and_then(|it| it.valid().chars().next());
        let rest = s.get(first.map_or(0, char::len_utf8)..).unwrap_or_default();
        [
            first
                .map_or_else(String::new, |it| change(it.encode_utf8(&mut [0; 4])))
                .as_bytes(),
            rest,
        ]
        .concat()
    }

    fn camel_case(s: &[u8]) -> Vec<u8> {
        if is_pascal_case(s) {
            return with_first(s, str::to_lowercase);
        }
        let mut out = Vec::with_capacity(s.len());
        let mut rest = s.iter().copied().peekable();
        while let Some(c) = rest.next() {
            match rest.next_if(|next| matches!(c, b'-' | b'_') && is_regex_word(*next)) {
                Some(next) => out.push(next.to_ascii_uppercase()),
                None => out.push(c),
            }
        }
        out
    }

    pub(crate) fn pascal_case(s: &[u8]) -> Vec<u8> {
        with_first(&camel_case(s), str::to_uppercase)
    }

    /// In lower case, with a `-` for each `_` and before each capital letter that follows a `\w` other than `_`.
    pub(crate) fn kebab_case(s: &[u8]) -> Vec<u8> {
        let mut out = Vec::with_capacity(s.len() + 4);
        let mut rest = s.iter().copied().peekable();
        while let Some(c) = rest.next() {
            out.push(if c == b'_' { b'-' } else { c });
            if c.is_ascii_alphanumeric() && rest.peek().is_some_and(u8::is_ascii_uppercase) {
                out.push(b'-');
            }
        }
        text::to_lower_case(&out).into_owned()
    }
}

pub(crate) enum DefineMacroProblem {
    DefineInBoth,
    HasTypeAndArguments,
    EventsNotDefined,
    ReferencingLocally,
}

/// `has_export_default_equivalent`: the other script of the file exports the same by default.
pub(crate) fn check_define_macro_call_expression(
    call: Call,
    has_export_default_equivalent: bool,
) -> Option<DefineMacroProblem> {
    let has_type_args = !call.type_args().is_empty();
    if has_type_args {
        return match (has_export_default_equivalent, call.args().is_empty()) {
            (true, _) => Some(DefineMacroProblem::DefineInBoth),
            (false, false) => Some(DefineMacroProblem::HasTypeAndArguments),
            (false, true) => None,
        };
    }
    let Some(expression) = call.args().first().filter(|it| it.tag() != ExprTag::Spread) else {
        return (!has_export_default_equivalent).then_some(DefineMacroProblem::EventsNotDefined);
    };
    if has_export_default_equivalent {
        return Some(DefineMacroProblem::DefineInBoth);
    }
    match expression.kind() {
        _ if expression.is_parenthesized() => Some(DefineMacroProblem::EventsNotDefined),
        ExprKind::Array(_) | ExprKind::Object(_) => None,
        // What the file does not declare can be from the other script.
        ExprKind::Ident(name) => {
            expression
                .file()
                .top_level_scope()
                .get_name(name)
                .and_then(|symbol| {
                    let is_imported = matches!(
                        symbol.declarations().next(),
                        Some(Declaration::ImportSpec(_))
                    );
                    (!is_imported).then_some(DefineMacroProblem::ReferencingLocally)
                })
        }
        _ => Some(DefineMacroProblem::EventsNotDefined),
    }
}

/// The calls of `name`, in the order of the source.
pub(crate) fn calls_of<'a>(file: &'a File<'a>, name: &str) -> Vec<(Expr<'a>, Call<'a>)> {
    let calls = file
        .exprs_of_kind(ExprTag::Call)
        .filter_map(|it| Some((it, it.as_call()?)));
    let mut calls: Vec<_> = calls
        .filter(|it| is_specific_id(it.1.callee(), name))
        .collect();
    utils::sort::sort_unstable_by_key(&mut calls, |it| it.0.span().start);
    calls
}

/// Where the `$nextTick` of `this.$nextTick` or the `nextTick` of `Vue.nextTick` is written, if `member` is one of these.
pub(crate) fn next_tick_property(member: Expr) -> Option<Span> {
    match member.kind() {
        ExprKind::Dot { obj, name, .. } => {
            let name_is = |text: &str| name.name().is(text);
            let is_next_tick = name_is("$nextTick") && is_this_object(obj)
                || name_is("nextTick") && is_specific_id(obj, "Vue");
            is_next_tick.then(|| name.span())
        }
        _ => None,
    }
}

/// The identifiers that refer to the `nextTick` that is imported from `vue`.
pub(crate) fn next_tick_imports<'a>(file: &'a File<'a>) -> impl Iterator<Item = Expr<'a>> {
    imported_from_vue(file, &["nextTick"])
        .flat_map(|it| it.0.references())
        .filter_map(|it| it.expr())
}

/// `signature.optional`: `a?: T`, `a?(): T`
pub(crate) fn is_optional_signature(signature: Member) -> bool {
    signature.flags().contains(Flags::OPTIONAL)
}

/// For [`enclosing_variable_declarator`].
pub(crate) type EnclosingDeclarators<'a> = AncestorMemo<'a, VarDecl<'a>>;

/// The innermost `VariableDeclarator` around `node`, whatever is between.
pub(crate) fn enclosing_variable_declarator<'a>(
    node: Expr<'a>,
    memo: &mut EnclosingDeclarators<'a>,
) -> Option<VarDecl<'a>> {
    memo.find(Node::Expr(node), |_, parent| match parent {
        Node::VarDecl(declarator) => Some(declarator),
        _ => None,
    })
}

/// The names that have a default value in the `{ a = 1, b }` that a declaration declares, for the declarations that were asked about.
#[derive(Default)]
pub(crate) struct DestructuredDefaults<'a> {
    declarators: EnclosingDeclarators<'a>,
    names: FxHashMap<VarDecl<'a>, Option<Rc<FxHashSet<Name<'a>>>>>,
}

impl<'a> DestructuredDefaults<'a> {
    /// Those of the innermost declaration around `node`. `None` if that declares no `{ .. }`.
    pub(crate) fn around(&mut self, node: Expr<'a>) -> Option<Rc<FxHashSet<Name<'a>>>> {
        let declarator = enclosing_variable_declarator(node, &mut self.declarators)?;
        let names = self
            .names
            .entry(declarator)
            .or_insert_with(|| match declarator.pat().kind() {
                PatKind::Object(properties) => {
                    let with_default = properties.iter().filter(|it| it.default().is_some());
                    Some(Rc::new(
                        with_default
                            .filter_map(|it| it.key().and_then(static_name))
                            .collect(),
                    ))
                }
                _ => None,
            });
        names.clone()
    }
}
