use crate::n::es_syntax::{Active, FEATURES, Feature};
use crate::n::es_syntax_data::*;
use crate::n::object_type::ExpressionTypes;
use crate::n::semver::Range;
use crate::n::table::Roots;
use crate::n::{DEFAULT_NODE_VERSION, configured_node_version_as, version_range};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::regex::{self, Handler, Mode as RegexMode};
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::eslint_utils::{ReferenceKind, ReferenceTracker, TraceMap, get_property_name, get_string_if_constant};
use rustc_hash::FxHashMap;
use std::cell::{Cell, RefCell};
use std::sync::OnceLock;

/// Disallow unsupported ECMAScript syntax on the specified version.
///
/// What finds a feature is the rule of eslint-plugin-es-x for it.
pub struct EsSyntax {
    /// That of the options, as it is written.
    version: Option<Vec<u8>>,
    ignores: Vec<Box<[u8]>>,
    /// What is reported with a range of versions, by the text of the range. `None`: the text is no range.
    known: [OnceLock<(Box<[u8]>, Option<Active>)>; 8],
}

const NOT_SUPPORTED_TILL: Message = Message::new(
    "not-supported-till",
    "'{{featureName}}' is not supported until Node.js {{supported}}. The configured version range is '{{version}}'.",
);
const NOT_SUPPORTED_YET: Message = Message::new(
    "not-supported-yet",
    "'{{featureName}}' is not supported in Node.js. The configured version range is '{{version}}'.",
);

/// What is reported at the end.
struct Found {
    at: Span,
    is_position: bool,
    feature: usize,
    supported: &'static str,
    /// Where it stands among those at one place.
    rank: u64,
}

#[derive(Default)]
pub struct State<'a> {
    /// Where in [`EsSyntax::known`] the range of versions of the file is.
    known: usize,
    /// If it is not there.
    own: Option<Box<Active>>,
    found: RefCell<Vec<Found>>,
    /// What is found from now on is what the rules of eslint-plugin-es-x report on `Program:exit`.
    is_at_the_end: Cell<bool>,
    /// Those of [`Active::methods`] that the file may name.
    methods: smallvec::SmallVec<[Name<'a>; 8]>,
    types: RefCell<ExpressionTypes<'a>>,
    /// The `var` declarators of the variables that have the name of a parameter of a `catch` clause, in the order of the source.
    var_declarators: FxHashMap<Symbol<'a>, Vec<VarDecl<'a>>>,
    /// The function around something, and the one that is not an arrow function.
    function_around: AncestorMemo<'a, ()>,
    function_with_this_around: AncestorMemo<'a, Func<'a>>,
}

type Context<'a> = Cx<'a, EsSyntax>;
type Bodies<'a> = smallvec::SmallVec<[List<'a, Stmt<'a>>; 4]>;

/// The reserved words of ECMAScript 3.
const KEYWORDS: [&str; 59] = [
    "abstract",
    "boolean",
    "break",
    "byte",
    "case",
    "catch",
    "char",
    "class",
    "const",
    "continue",
    "debugger",
    "default",
    "delete",
    "do",
    "double",
    "else",
    "enum",
    "export",
    "extends",
    "false",
    "final",
    "finally",
    "float",
    "for",
    "function",
    "goto",
    "if",
    "implements",
    "import",
    "in",
    "instanceof",
    "int",
    "interface",
    "long",
    "native",
    "new",
    "null",
    "package",
    "private",
    "protected",
    "public",
    "return",
    "short",
    "static",
    "super",
    "switch",
    "synchronized",
    "this",
    "throw",
    "throws",
    "transient",
    "true",
    "try",
    "typeof",
    "var",
    "void",
    "volatile",
    "while",
    "with",
];

const LEGACY_ACCESSOR_METHODS: [&str; 4] = ["__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__"];

fn is_keyword(name: Name) -> bool {
    KEYWORDS.binary_search_by(|it| it.as_bytes().cmp(name.bytes())).is_ok()
}

/// ESLint's `:function`
fn is_function(func: Func) -> bool {
    func.has_body()
        && matches!(
            func.kind(),
            FnKind::Decl | FnKind::Expr | FnKind::Arrow | FnKind::Method | FnKind::Getter | FnKind::Setter | FnKind::Constructor
        )
}

fn is_in_function<'a>(node: Node<'a>, known: &mut AncestorMemo<'a, ()>) -> bool {
    known.find(node, |_, parent| matches!(parent, Node::Func(func) if is_function(func)).then_some(())).is_some()
}

/// The `,` before the token at `close`, if there is one.
fn comma_before<'a>(file: &'a File<'a>, close: u32) -> Option<Span> {
    let end = file.end_of_token_before(close);
    (end > 0 && file.text().get(end as usize - 1) == Some(&b',')).then(|| Span::new(end - 1, end))
}

/// The `?.` after `before`.
fn question_dot(file: &File, before: Expr) -> Span {
    let start = skip_trivia(file.text(), before.outer_span().end);
    Span::new(start, start + 2)
}

/// A listener as a number to sort by. ESLint calls those for an outer node first, and those for one node in the order of
/// the attributes and then of the kinds of nodes that their selectors name.
const fn listener(depth: u64, attributes: u64, kinds: u64) -> u64 {
    (depth << 8) | (attributes << 4) | kinds
}

/// For a node around what is reported, or before it.
const OUTER: u64 = 0;
/// For a property, which can be as long as its value.
const PROPERTY: u64 = 1;
const NODE: u64 = 2;
/// For a node in what is reported.
const INNER: u64 = 3;
const NODE_EXIT: u64 = 4;
const PROGRAM_EXIT: u64 = 5;

/// The listener that reports `feature`, where it matters: where something else can be reported at the same place.
const fn listener_of(feature: usize) -> u64 {
    match feature {
        CLASS_FIELDS | SHADOW_CATCH_PARAM => listener(OUTER, 0, 0),
        KEYWORD_PROPERTIES => listener(PROPERTY, 0, 1),
        COMPUTED_PROPERTIES => listener(PROPERTY, 1, 2),
        PROPERTY_SHORTHANDS => listener(PROPERTY, 2, 3),
        ACCESSOR_PROPERTIES => listener(PROPERTY, 4, 4),
        BLOCK_SCOPED_FUNCTIONS => listener(NODE, 0, 2),
        TEMPLATE_LITERALS => listener(NODE, 0, 3),
        MODULES | TRAILING_COMMAS => listener(NODE, 0, 4),
        DESTRUCTURING => listener(NODE, 0, 8),
        ASYNC_FUNCTIONS | GENERATORS => listener(NODE, 1, 0),
        EXPORT_NS_FROM
        | REGEXP_D_FLAG
        | REGEXP_LOOKBEHIND_ASSERTIONS
        | REGEXP_NAMED_CAPTURE_GROUPS
        | REGEXP_S_FLAG
        | REGEXP_U_FLAG
        | REGEXP_UNICODE_PROPERTY_ESCAPES
        | REGEXP_UNICODE_PROPERTY_ESCAPES_2019
        | REGEXP_UNICODE_PROPERTY_ESCAPES_2020
        | REGEXP_UNICODE_PROPERTY_ESCAPES_2021
        | REGEXP_UNICODE_PROPERTY_ESCAPES_2022
        | REGEXP_UNICODE_PROPERTY_ESCAPES_2023
        | REGEXP_V_FLAG
        | REGEXP_Y_FLAG => listener(NODE, 1, 1),
        TOP_LEVEL_AWAIT => listener(NODE, 1, 2),
        ASYNC_ITERATION => listener(NODE, 2, 0),
        PRIVATE_IN => listener(NODE, 2, 2),
        FUNCTION_DECLARATIONS_IN_IF_STATEMENT_CLAUSES_WITHOUT_BLOCK => listener(NODE, 2, 4),
        INITIALIZERS_IN_FOR_IN => listener(NODE, 3, 3),
        ARBITRARY_MODULE_NAMESPACE_NAMES => listener(NODE, 4, 8),
        MALFORMED_TEMPLATE_LITERALS => listener(INNER, 0, 0),
        ARROW_FUNCTIONS => listener(NODE_EXIT, 0, 0),
        _ => listener(NODE, 0, 1),
    }
}

/// [`State::methods`]
fn methods_in<'a>(active: &Active, file: &'a File<'a>) -> smallvec::SmallVec<[Name<'a>; 8]> {
    let mentioned = active.method_names.iter().filter(|it| file.mentions_bit(it.1));
    mentioned.map(|it| file.name_of(it.0)).collect()
}

impl Rule for EsSyntax {
    const META: Meta = Meta::plugin(Plugin::Node, "no-unsupported-features/es-syntax", Kind::Problem).recommended();
    const ON: On = On::new()
        .funcs()
        .params()
        .classes()
        .members()
        .props()
        .nodes(NodeTags::PAT_PROP)
        .pats(&[PatTag::Array, PatTag::Object])
        .exprs(&[ExprTag::Array, ExprTag::Object, ExprTag::Assign])
        .binaries(&[BinOp::Pow, BinOp::Nullish])
        .exprs(&[ExprTag::ImportCall, ExprTag::ImportMeta, ExprTag::NewTarget, ExprTag::Spread])
        .exprs(&[ExprTag::Template, ExprTag::TaggedTemplate, ExprTag::Await, ExprTag::Call, ExprTag::New])
        .exprs(&[ExprTag::Dot, ExprTag::Index, ExprTag::PrivateIdentifier, ExprTag::Super, ExprTag::Regex])
        .stmts(&[StmtTag::Var, StmtTag::Fn, StmtTag::ForOf, StmtTag::ForIn, StmtTag::Try])
        .types(&[TypeTag::StringLit])
        .number_literals()
        .string_literals()
        .finish();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        EsSyntax {
            version: version_range(options.get(0)).map(|it| it.raw),
            ignores: options.object(0).strings("ignores").iter().map(|it| it.as_bytes().into()).collect(),
            known: Default::default(),
        }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let found = self.active_in(file);
        let active = found.as_ref().and_then(|it| it.1.as_deref().or_else(|| self.kept(it.0)));
        let Some(active) = active.filter(|it| it.has_any()) else {
            return On::new();
        };
        let any = |features: &[usize]| features.iter().any(|&it| active.has(it));
        // Everything is reported at the end.
        let mut on = On::new().finish();

        if any(&[ARROW_FUNCTIONS, ASYNC_FUNCTIONS, ASYNC_ITERATION, GENERATORS, TRAILING_FUNCTION_COMMAS]) {
            on = on.funcs();
        }
        if any(&[DEFAULT_PARAMETERS, REST_PARAMETERS, DESTRUCTURING]) {
            on = on.params();
        }
        if active.has(CLASSES) {
            on = on.classes();
        }
        let has_templates = any(&[TEMPLATE_LITERALS, MALFORMED_TEMPLATE_LITERALS]);
        if has_templates || any(&[ACCESSOR_PROPERTIES, COMPUTED_PROPERTIES, CLASS_FIELDS, CLASS_STATIC_BLOCK]) {
            on = on.members();
        }
        if has_templates
            || any(&[ACCESSOR_PROPERTIES, COMPUTED_PROPERTIES, KEYWORD_PROPERTIES, PROPERTY_SHORTHANDS, REST_SPREAD_PROPERTIES])
        {
            on = on.props();
        }
        if has_templates || any(&[COMPUTED_PROPERTIES, KEYWORD_PROPERTIES, REST_SPREAD_PROPERTIES]) {
            on = on.nodes(NodeTags::PAT_PROP);
        }
        if any(&[DESTRUCTURING, TRAILING_COMMAS]) {
            on = on.pats(&[PatTag::Array, PatTag::Object]);
        }
        if active.has(TRAILING_COMMAS) {
            on = on.exprs(&[ExprTag::Array, ExprTag::Object]);
        }
        if any(&[EXPONENTIAL_OPERATORS, LOGICAL_ASSIGNMENT_OPERATORS, DESTRUCTURING]) {
            on = on.exprs(&[ExprTag::Assign]);
        }
        if active.has(EXPONENTIAL_OPERATORS) {
            on = on.binaries(&[BinOp::Pow]);
        }
        if active.has(NULLISH_COALESCING_OPERATORS) {
            on = on.binaries(&[BinOp::Nullish]);
        }
        for (feature, tag) in [(DYNAMIC_IMPORT, ExprTag::ImportCall), (IMPORT_META, ExprTag::ImportMeta), (NEW_TARGET, ExprTag::NewTarget)] {
            if active.has(feature) {
                on = on.exprs(&[tag]);
            }
        }
        if active.has(SPREAD_ELEMENTS) {
            on = on.exprs(&[ExprTag::Spread]);
        }
        if has_templates {
            on = on.exprs(&[ExprTag::Template, ExprTag::TaggedTemplate]).types(&[TypeTag::StringLit]);
        }
        if active.has(TOP_LEVEL_AWAIT) {
            on = on.exprs(&[ExprTag::Await]);
        }
        if any(&[TRAILING_FUNCTION_COMMAS, OPTIONAL_CHAINING]) {
            on = on.exprs(&[ExprTag::Call, ExprTag::New]);
        }
        if any(&[OPTIONAL_CHAINING, KEYWORD_PROPERTIES, CLASS_FIELDS, LEGACY_OBJECT_PROTOTYPE_ACCESSOR_METHODS])
            || active.method_names.iter().any(|it| file.mentions_bit(it.1))
        {
            on = on.exprs(&[ExprTag::Dot, ExprTag::Index]);
        }
        if any(&[CLASS_FIELDS, PRIVATE_IN]) {
            on = on.exprs(&[ExprTag::PrivateIdentifier]);
        }
        if active.has(OBJECT_SUPER_PROPERTIES) {
            on = on.exprs(&[ExprTag::Super]);
        }
        if active.has_regexp() {
            on = on.exprs(&[ExprTag::Regex]);
        }
        if active.has(BLOCK_SCOPED_VARIABLES) {
            on = on.stmts(&[StmtTag::Var]);
        }
        if any(&[
            BLOCK_SCOPED_FUNCTIONS,
            FUNCTION_DECLARATIONS_IN_IF_STATEMENT_CLAUSES_WITHOUT_BLOCK,
            LABELLED_FUNCTION_DECLARATIONS,
        ]) {
            on = on.stmts(&[StmtTag::Fn]);
        }
        if any(&[FOR_OF_LOOPS, ASYNC_ITERATION, TOP_LEVEL_AWAIT, DESTRUCTURING, INITIALIZERS_IN_FOR_IN]) {
            on = on.stmts(&[StmtTag::ForOf, StmtTag::ForIn]);
        }
        if any(&[OPTIONAL_CATCH_BINDING, SHADOW_CATCH_PARAM]) {
            on = on.stmts(&[StmtTag::Try]);
        }
        if any(&[BIGINT, BINARY_NUMERIC_LITERALS, OCTAL_NUMERIC_LITERALS, NUMERIC_SEPARATORS]) {
            on = on.number_literals();
        }
        if active.has(JSON_SUPERSET) && strings::contains(file.text(), b"\xE2\x80") {
            on = on.string_literals();
        }
        on
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        let (known, own) = self.active_in(file)?;
        let methods = methods_in(own.as_deref().or_else(|| self.kept(known))?, file);
        Some(State {
            known,
            own,
            methods,
            ..State::default()
        })
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Context<'a>) {
        match e.tag() {
            ExprTag::Array | ExprTag::Object => {
                if comma_before(cx.file(), e.span().end - 1).is_some() {
                    self.report(cx, TRAILING_COMMAS, e.span());
                }
            }
            ExprTag::Assign => self.assign(e, cx),
            ExprTag::ImportCall | ExprTag::ImportMeta | ExprTag::NewTarget => {
                let feature = match e.tag() {
                    ExprTag::ImportCall => DYNAMIC_IMPORT,
                    ExprTag::ImportMeta => IMPORT_META,
                    _ => NEW_TARGET,
                };
                self.report(cx, feature, e.span());
            }
            ExprTag::Spread => self.spread(e, cx),
            ExprTag::Template | ExprTag::TaggedTemplate => self.template(e, cx),
            ExprTag::Await => {
                if !is_in_function(Node::Expr(e), &mut cx.state.function_around) {
                    self.report(cx, TOP_LEVEL_AWAIT, e.span());
                }
            }
            ExprTag::Call | ExprTag::New => self.call(e, cx),
            ExprTag::Dot | ExprTag::Index => self.member_expression(e, cx),
            ExprTag::PrivateIdentifier => {
                self.report(cx, CLASS_FIELDS, e.span());
                self.report(cx, PRIVATE_IN, e.span());
            }
            ExprTag::Super => self.super_keyword(e, cx),
            ExprTag::Regex => {
                if let ExprKind::Regex(literal) = e.kind() {
                    self.regexp(cx, e.span(), Some(literal.pattern()), Some(literal.flags()));
                }
            }
            _ => {}
        }
    }

    fn binary<'a>(&self, e: Expr<'a>, cx: &mut Context<'a>) {
        match e.binary_op() {
            Some(BinOp::Pow) => self.report(cx, EXPONENTIAL_OPERATORS, e.span()),
            Some(BinOp::Nullish) => {
                if let Some(operator) = e.operator_span() {
                    self.report(cx, NULLISH_COALESCING_OPERATORS, operator);
                }
            }
            _ => {}
        }
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Context<'a>) {
        match stmt.tag() {
            StmtTag::Var => {
                if let StmtKind::Var(declarators) = stmt.kind()
                    && matches!(declarators.first().map(VarDecl::var_kind), Some(VarKind::Let | VarKind::Const))
                {
                    self.report_in(cx, BLOCK_SCOPED_VARIABLES, stmt.span_without_export(), Node::Stmt(stmt));
                }
            }
            StmtTag::Fn => self.function_declaration(stmt, cx),
            StmtTag::ForOf | StmtTag::ForIn => self.for_in_or_of(stmt, cx),
            StmtTag::Try => self.try_statement(stmt, cx),
            _ => {}
        }
    }

    fn ty<'a>(&self, ty: TypeNode<'a>, cx: &mut Context<'a>) {
        // `` `a` `` is a `TemplateLiteral` as a type too.
        if let TypeKind::StringLit(value) = ty.kind()
            && cx.text().get(ty.span().start as usize) == Some(&b'`')
        {
            self.report(cx, TEMPLATE_LITERALS, ty.span());
            if value.is("null") {
                self.report(cx, MALFORMED_TEMPLATE_LITERALS, ty.span());
            }
        }
    }

    fn pat<'a>(&self, pat: Pat<'a>, cx: &mut Context<'a>) {
        if comma_before(cx.file(), pat.span().end - 1).is_some() {
            self.report(cx, TRAILING_COMMAS, utils::estree_span(Node::Pat(pat)));
        }
        if let Node::VarDecl(declarator) = pat.parent()
            && matches!(declarator.parent(), Node::Stmt(stmt) if stmt.tag() == StmtTag::Var)
        {
            self.report(cx, DESTRUCTURING, utils::estree_span(Node::Pat(pat)));
        }
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Context<'a>) {
        if !is_function(func) {
            return;
        }
        let span = func.estree_span();
        if func.is_arrow() {
            self.report(cx, ARROW_FUNCTIONS, span);
        }
        if func.is_async() {
            self.report(cx, ASYNC_FUNCTIONS, span);
        }
        if func.is_generator() {
            self.report(cx, GENERATORS, span);
            if func.is_async() {
                self.report(cx, ASYNC_ITERATION, span);
            }
        }
        if let Some(last) = func.params_with_this().last() {
            let after = skip_trivia(cx.text(), last.span().end);
            if cx.text().get(after as usize) == Some(&b',') {
                self.report(cx, TRAILING_FUNCTION_COMMAS, Span::new(after, after + 1));
            }
        }
    }

    fn class<'a>(&self, class: Class<'a>, cx: &mut Context<'a>) {
        self.report_in(cx, CLASSES, class.estree_span(), Node::Class(class));
    }

    fn member<'a>(&self, member: Member<'a>, cx: &mut Context<'a>) {
        self.template_as_key(member.key(), cx);
        if !matches!(member.parent(), Node::Class(_)) || member.flags().contains(Flags::ABSTRACT) {
            return;
        }
        let key = member.key();
        let key_span = key.map(|it| it.inner_span(cx.file()));
        // Of an `accessor` the `#a` alone counts.
        let is_field = match member.flags().contains(Flags::ACCESSOR) {
            true => key.is_some_and(Key::is_private),
            false => !member.flags().contains(Flags::AMBIENT),
        };
        match member.kind() {
            MemberKind::StaticBlock => self.report(cx, CLASS_STATIC_BLOCK, member.span()),
            MemberKind::Property if is_field => {
                if let Some(key_span) = key_span {
                    self.report(cx, CLASS_FIELDS, key_span);
                }
            }
            kind @ (MemberKind::Method | MemberKind::Getter | MemberKind::Setter) => {
                if kind != MemberKind::Method {
                    self.report(cx, ACCESSOR_PROPERTIES, member.span());
                }
                if key.is_some_and(Key::is_computed) {
                    self.report(cx, COMPUTED_PROPERTIES, member.span());
                }
                if let Some(key_span) = key_span.filter(|_| key.is_some_and(Key::is_private)) {
                    self.report(cx, CLASS_FIELDS, key_span);
                }
            }
            _ => {}
        }
    }

    fn prop<'a>(&self, prop: Prop<'a>, cx: &mut Context<'a>) {
        if prop.is_jsx_attribute() || prop.is_import_attribute() {
            return;
        }
        self.template_as_key(prop.key(), cx);
        let span = prop.span();
        match prop.kind() {
            PropKind::Spread => return self.report(cx, REST_SPREAD_PROPERTIES, span),
            PropKind::Getter | PropKind::Setter => self.report(cx, ACCESSOR_PROPERTIES, span),
            PropKind::Method | PropKind::Shorthand => {
                if !matches!(prop.parent(), Node::Expr(object) if object.is_assignment_target()) {
                    self.report(cx, PROPERTY_SHORTHANDS, span);
                }
            }
            PropKind::Init => {}
        }
        match prop.key().map(Key::kind) {
            Some(KeyKind::Ident(name)) if is_keyword(name) => self.report(cx, KEYWORD_PROPERTIES, span),
            Some(KeyKind::Computed(_) | KeyKind::ComputedString(_) | KeyKind::ComputedNumber(_)) => {
                self.report(cx, COMPUTED_PROPERTIES, span);
            }
            _ => {}
        }
    }

    fn param<'a>(&self, param: Param<'a>, cx: &mut Context<'a>) {
        if param.is_parameter_property() || !param.func().is_some_and(is_function) {
            return;
        }
        if param.default().is_some() {
            self.report(cx, DEFAULT_PARAMETERS, utils::estree_span(Node::Param(param)));
        }
        if param.is_rest() {
            self.report(cx, REST_PARAMETERS, utils::estree_span(Node::Param(param)));
        }
        if matches!(param.pat().tag(), PatTag::Array | PatTag::Object) {
            self.report(cx, DESTRUCTURING, utils::estree_span(Node::Pat(param.pat())));
        }
    }

    fn string_literal<'a>(&self, literal: Literal<'a>, cx: &mut Context<'a>) {
        self.string(literal, cx);
    }

    fn number_literal<'a>(&self, literal: Literal<'a>, cx: &mut Context<'a>) {
        self.number(literal, cx);
    }

    fn node<'a>(&self, node: Node<'a>, cx: &mut Context<'a>) {
        self.pat_prop(node, cx);
    }

    fn finish(&self, cx: &mut Context<'_>) {
        const REGEXP: TraceMap<'static, ()> = TraceMap::new(&[("RegExp", TraceMap::EMPTY.call(()).construct(()))]);
        let file = cx.file();
        let Some(active) = self.active(&cx.state) else {
            return;
        };
        if active.has(HASHBANG) && strings::without_utf8_bom(file.text()).starts_with(b"#!")
            && let Some(comment) = file.comments().next().filter(|it| it.kind() == TokenKind::Shebang)
        {
            self.report(cx, HASHBANG, comment.span());
        }
        if active.has(MODULES) || active.has(EXPORT_NS_FROM) || active.has(ARBITRARY_MODULE_NAMESPACE_NAMES) {
            self.modules(cx);
        }
        if active.has(UNICODE_CODEPOINT_ESCAPES) && strings::contains(file.text(), b"\\u{") {
            self.unicode_codepoint_escapes(cx);
        }
        if active.has(LEGACY_OBJECT_PROTOTYPE_ACCESSOR_METHODS) {
            for name in LEGACY_ACCESSOR_METHODS {
                for reference in file.unresolved_references_to(name.as_bytes()) {
                    self.report(cx, LEGACY_OBJECT_PROTOTYPE_ACCESSOR_METHODS, reference.span());
                }
            }
        }
        cx.state.is_at_the_end.set(true);
        let tracker = ReferenceTracker::new(file);
        for feature in active.globals_in(file) {
            let globals = FEATURES.get(feature).map_or(&[][..], Feature::globals);
            for reference in tracker.iterate_global_references(&Roots(globals.iter().collect())) {
                self.report(cx, feature, reference.span);
            }
        }
        if active.has_regexp() && file.mentions("RegExp") {
            for reference in tracker.iterate_global_references(&REGEXP) {
                let Some(call) = reference.call() else {
                    continue;
                };
                let text = |at: usize| call.args().get(at).and_then(|it| get_string_if_constant(it, Some(file.scope())));
                self.regexp(cx, reference.span, text(0).as_deref(), text(1).as_deref());
            }
        }
        if active.has(SUBCLASSING_BUILTINS) {
            self.subclassing_builtins(cx, &tracker);
        }
        if active.has(ERROR_CAUSE) && file.mentions("cause") {
            self.error_cause(cx, &tracker);
        }
        if active.has(RESIZABLE_AND_GROWABLE_ARRAYBUFFERS) && file.mentions_any(&["ArrayBuffer", "SharedArrayBuffer"]) {
            const BUFFERS: TraceMap<'static, ()> = TraceMap::new(&[
                ("ArrayBuffer", TraceMap::EMPTY.construct(())),
                ("SharedArrayBuffer", TraceMap::EMPTY.construct(())),
            ]);
            for reference in tracker.iterate_global_references(&BUFFERS) {
                let Some(call) = reference.call().filter(|_| reference.expr().is_some_and(|it| it.tag() == ExprTag::New)) else {
                    continue;
                };
                if !call.args().iter().take(2).any(|it| it.tag() == ExprTag::Spread)
                    && let Some(options) = call.args().get(1)
                {
                    self.report(cx, RESIZABLE_AND_GROWABLE_ARRAYBUFFERS, options.span());
                }
            }
        }
        // Of what starts at one place: on entering a node the outer first, on leaving one the inner, at the end of the
        // program as the features follow each other.
        let mut found = cx.state.found.take();
        utils::sort::sort_by_key(&mut found, |it| {
            let depth = it.rank >> 40;
            let end = match depth {
                NODE_EXIT => it.at.end,
                PROGRAM_EXIT => 0,
                _ => u32::MAX - it.at.end,
            };
            (it.at.start, depth.max(INNER), end, it.rank)
        });
        // The linter puts the longer first, and then what is reported `on_exit`, the shorter first.
        let (mut before, mut is_on_exit) = (Span::empty(u32::MAX), false);
        for it in found {
            let Some(data) = FEATURES.get(it.feature) else {
                continue;
            };
            is_on_exit = before.start == it.at.start && (is_on_exit || before.end < it.at.end);
            before = it.at;
            let message = if data.supported().is_none() { NOT_SUPPORTED_YET } else { NOT_SUPPORTED_TILL };
            let report = if it.is_position { cx.report_at(it.at.start, message) } else { cx.report(it.at, message) };
            let report = report.on_exit(is_on_exit).data("featureName", data.name()).data("supported", it.supported);
            report.data("version", active.version.raw.clone());
        }
    }
}

/// What the rules about the patterns of regular expressions look for.
#[derive(Default)]
struct Pattern {
    has_lookbehind: bool,
    has_named_group: bool,
    has_property_escape: bool,
    /// For each year from 2019: `\p{..}` with what that year has added.
    has_property_of_year: [bool; 5],
}

impl Handler for Pattern {
    fn on_lookaround_assertion_enter(&mut self, _: u32, behind: bool, _: bool) {
        self.has_lookbehind |= behind;
    }
    fn on_capturing_group_enter(&mut self, _: u32, name: Option<&[u8]>) {
        self.has_named_group |= name.is_some_and(|it| !it.is_empty());
    }
    fn on_backreference(&mut self, _: u32, _: u32, reference: regex::ast::Reference<'_>) {
        self.has_named_group |= matches!(reference, regex::ast::Reference::Name(_));
    }
    fn on_unicode_property_character_set(&mut self, _: u32, _: u32, key: &[u8], value: Option<&[u8]>, _: bool, _: bool) {
        self.has_property_escape = true;
        let has = |set: &[&str], name: &[u8]| set.binary_search_by(|it| it.as_bytes().cmp(name)).is_ok();
        for (found, (scripts, binary)) in self.has_property_of_year.iter_mut().zip(&UNICODE_PROPERTIES) {
            *found |= match value.filter(|it| !it.is_empty()) {
                Some(value) => matches!(key, b"Script" | b"Script_Extensions" | b"sc" | b"scx") && has(scripts, value),
                None => has(binary, key),
            };
        }
    }
}

impl EsSyntax {
    /// [`State::known`] and [`State::own`] for the range of versions that `text` is, if it is one.
    fn with_range(&self, text: &[u8]) -> Option<(usize, Option<Box<Active>>)> {
        let active = || Range::parse(text).map(|it| Active::new(it, &self.ignores));
        for (at, known) in self.known.iter().enumerate() {
            let (range, found) = known.get_or_init(|| (text.into(), active()));
            if **range == *text {
                return found.as_ref().map(|_| (at, None));
            }
        }
        active().map(|it| (0, Some(Box::new(it))))
    }

    /// [`State::known`] and [`State::own`] for `file`.
    fn active_in(&self, file: &File) -> Option<(usize, Option<Box<Active>>)> {
        match &self.version {
            Some(version) => self.with_range(version),
            None => configured_node_version_as(file, |text| self.with_range(text))
                .or_else(|| self.with_range(DEFAULT_NODE_VERSION)),
        }
    }

    fn kept(&self, at: usize) -> Option<&Active> {
        self.known.get(at)?.get()?.1.as_ref()
    }

    fn active<'s>(&'s self, state: &'s State<'_>) -> Option<&'s Active> {
        state.own.as_deref().or_else(|| self.kept(state.known))
    }

    fn report<'a>(&self, cx: &Context<'a>, feature: usize, at: Span) {
        self.report_with(cx, feature, at, None, false, listener_of(feature));
    }

    /// For a feature that has several listeners.
    fn report_of<'a>(&self, cx: &Context<'a>, feature: usize, at: Span, by: u64) {
        self.report_with(cx, feature, at, None, false, by);
    }

    /// For a feature that was supported in strict mode first. `node`: what is reported.
    fn report_in<'a>(&self, cx: &Context<'a>, feature: usize, at: Span, node: Node<'a>) {
        self.report_with(cx, feature, at, Some(node), false, listener_of(feature));
    }

    fn report_with<'a>(&self, cx: &Context<'a>, feature: usize, at: Span, node: Option<Node<'a>>, is_position: bool, by: u64) {
        let Some(active) = self.active(&cx.state).filter(|it| it.has(feature)) else {
            return;
        };
        let Some(data) = FEATURES.get(feature) else {
            return;
        };
        let mut supported = data.supported_range();
        if let (Some(strict_mode), Some(node)) = (data.strict_mode(), node) {
            // `normalizeScope`
            let mut scope = node.scope();
            while let Some(upper) = scope.parent().filter(|_| scope.node() == node) {
                scope = upper;
            }
            if !scope.is_strict() {
                supported = strict_mode;
            } else if Range::parse(data.supported_range().as_bytes()).is_some_and(|it| active.version.is_subset_of(&it)) {
                return;
            }
        }
        let by = if cx.state.is_at_the_end.get() { listener(PROGRAM_EXIT, 0, 1) } else { by };
        cx.state.found.borrow_mut().push(Found {
            at,
            is_position,
            feature,
            supported,
            rank: (by << 32) | ((active.listens_for(feature) as u64) << 16) | feature as u64,
        });
    }

    /// `` [`a`] ``, which is no expression here.
    fn template_as_key<'a>(&self, key: Option<Key<'a>>, cx: &Context<'a>) {
        if let Some(key) = key
            && let KeyKind::ComputedString(value) = key.kind()
            && let span = key.inner_span(cx.file())
            && cx.text().get(span.start as usize) == Some(&b'`')
        {
            self.report(cx, TEMPLATE_LITERALS, span);
            if value.is("null") {
                self.report(cx, MALFORMED_TEMPLATE_LITERALS, span);
            }
        }
    }

    fn pat_prop<'a>(&self, node: Node<'a>, cx: &mut Context<'a>) {
        let Node::PatProp(prop) = node else {
            return;
        };
        self.template_as_key(prop.key(), cx);
        if prop.is_rest() {
            return self.report(cx, REST_SPREAD_PROPERTIES, prop.span());
        }
        match prop.key().map(Key::kind) {
            Some(KeyKind::Ident(name)) if is_keyword(name) => self.report(cx, KEYWORD_PROPERTIES, prop.span()),
            Some(KeyKind::Computed(_) | KeyKind::ComputedString(_) | KeyKind::ComputedNumber(_)) => {
                self.report(cx, COMPUTED_PROPERTIES, prop.span());
            }
            _ => {}
        }
    }

    fn assign<'a>(&self, e: Expr<'a>, cx: &mut Context<'a>) {
        let ExprKind::Assign { op, target, .. } = e.kind() else {
            return;
        };
        match op {
            Some(BinOp::Pow) => self.report(cx, EXPONENTIAL_OPERATORS, e.span()),
            Some(BinOp::And | BinOp::Or | BinOp::Nullish) => {
                // `getTokenAfter(node.left)`: after `(a)` that is the `)`.
                let after = skip_trivia(cx.text(), target.span().end);
                let paren = (cx.text().get(after as usize) == Some(&b')')).then(|| Span::new(after, after + 1));
                if let Some(token) = paren.or_else(|| e.operator_span()) {
                    self.report(cx, LOGICAL_ASSIGNMENT_OPERATORS, token);
                }
            }
            None if matches!(target.tag(), ExprTag::Array | ExprTag::Object) && !target.is_parenthesized() && !e.is_assignment_target() => {
                self.report(cx, DESTRUCTURING, target.span());
            }
            _ => {}
        }
    }

    fn spread<'a>(&self, e: Expr<'a>, cx: &mut Context<'a>) {
        let is_element = match e.parent() {
            Node::Expr(parent) => match parent.tag() {
                ExprTag::Array => !parent.is_assignment_target(),
                ExprTag::Call | ExprTag::New => true,
                _ => false,
            },
            _ => false,
        };
        if is_element {
            self.report(cx, SPREAD_ELEMENTS, e.span());
        }
    }

    fn template<'a>(&self, e: Expr<'a>, cx: &mut Context<'a>) {
        let ExprKind::Template(template) = e.kind() else {
            return self.report(cx, TEMPLATE_LITERALS, e.span());
        };
        // The selector is `:not(TaggedTemplateExpression) > TemplateLiteral`: nor one that is the tag.
        if !matches!(e.parent(), Node::Expr(parent) if parent.tag() == ExprTag::TaggedTemplate) {
            self.report(cx, TEMPLATE_LITERALS, e.span());
        }
        // The selector is `TemplateElement[value.cooked=null]`, which compares texts.
        if (0..template.quasi_count()).any(|i| template.cooked(i).is_none_or(|it| it.is("null"))) {
            self.report(cx, MALFORMED_TEMPLATE_LITERALS, e.span());
        }
    }

    fn call<'a>(&self, e: Expr<'a>, cx: &mut Context<'a>) {
        let (ExprKind::Call(call) | ExprKind::New(call)) = e.kind() else {
            return;
        };
        if !call.args().is_empty()
            && let Some(comma) = call.close_paren().and_then(|close| comma_before(cx.file(), close))
        {
            self.report(cx, TRAILING_FUNCTION_COMMAS, comma);
        }
        if call.is_optional() {
            self.report(cx, OPTIONAL_CHAINING, question_dot(cx.file(), call.callee()));
        }
    }

    fn member_expression<'a>(&self, e: Expr<'a>, cx: &mut Context<'a>) {
        let Some(active) = self.active(&cx.state) else {
            return;
        };
        let (obj, chain) = match e.kind() {
            ExprKind::Dot { obj, chain, .. } | ExprKind::Index { obj, chain, .. } => (obj, chain),
            _ => return,
        };
        // Most are nothing that is looked for.
        let is_candidate = chain == Chain::Start
            || active.has(LEGACY_OBJECT_PROTOTYPE_ACCESSOR_METHODS)
            || match e.kind() {
                ExprKind::Dot { name, .. } => {
                    name.bytes().starts_with(b"#")
                        || cx.state.methods.contains(&name.name())
                        || active.has(KEYWORD_PROPERTIES) && is_keyword(name.name())
                }
                _ => true,
            };
        if !is_candidate || e.is_jsx_tag_name() || e.is_in_type_query() {
            return;
        }
        if chain == Chain::Start {
            self.report(cx, OPTIONAL_CHAINING, question_dot(cx.file(), obj));
        }
        if let ExprKind::Dot { name, .. } = e.kind() {
            if name.bytes().starts_with(b"#") {
                return self.report(cx, CLASS_FIELDS, name.span());
            }
            if active.has(KEYWORD_PROPERTIES) && is_keyword(name.name()) {
                self.report_of(cx, KEYWORD_PROPERTIES, e.span(), listener(NODE, 0, 1));
            }
            // Most are none of the methods.
            if !cx.state.methods.contains(&name.name()) && !active.has(LEGACY_OBJECT_PROTOTYPE_ACCESSOR_METHODS) {
                return;
            }
        }
        if active.has(LEGACY_OBJECT_PROTOTYPE_ACCESSOR_METHODS)
            && let Some(name) = get_property_name(e, None)
            && LEGACY_ACCESSOR_METHODS.iter().any(|it| it.as_bytes() == &name[..])
        {
            let property = match e.kind() {
                ExprKind::Dot { name, .. } => name.span(),
                ExprKind::Index { index, .. } => index.span(),
                _ => return,
            };
            self.report(cx, LEGACY_OBJECT_PROTOTYPE_ACCESSOR_METHODS, property);
        }
        if cx.state.methods.is_empty() {
            return;
        }
        let Some(name) = get_property_name(e, Some(Node::Expr(e).scope())) else {
            return;
        };
        let is_aggressive = cx.settings().get(b"es-x").and_then(|it| it.get(b"aggressive")?.as_bool()) == Some(true);
        let mut object_type = None;
        let mut reported = usize::MAX;
        for &(_, feature, class) in active.methods.iter().filter(|it| it.0.as_bytes() == &name[..]) {
            // A rule reports a member access once.
            if feature == reported {
                continue;
            }
            let found = *object_type.get_or_insert_with(|| cx.state.types.borrow_mut().get_type(obj));
            if found.map_or(is_aggressive, |it| it == class) {
                reported = feature;
                self.report(cx, feature, e.span());
            }
        }
    }

    fn super_keyword<'a>(&self, e: Expr<'a>, cx: &mut Context<'a>) {
        // The function that it is in, not counting arrow functions.
        let with_this = |it: Node<'a>| it.as_func().filter(|it| is_function(*it) && !it.is_arrow());
        let func = cx.state.function_with_this_around.find(Node::Expr(e), |_, parent| with_this(parent));
        let is_in_object_method = func.is_some_and(|func| match func.owner() {
            Node::Expr(owner) => matches!(owner.parent(), Node::Prop(prop) if prop.kind() == PropKind::Method),
            _ => false,
        });
        if is_in_object_method {
            self.report(cx, OBJECT_SUPER_PROPERTIES, e.span());
        }
    }

    fn function_declaration<'a>(&self, stmt: Stmt<'a>, cx: &mut Context<'a>) {
        let StmtKind::Fn(func) = stmt.kind() else {
            return;
        };
        let Node::Stmt(parent) = stmt.parent() else {
            return;
        };
        if !func.has_body() {
            return;
        }
        let span = stmt.span_without_export();
        match parent.tag() {
            StmtTag::Block => self.report_in(cx, BLOCK_SCOPED_FUNCTIONS, span, Node::Func(func)),
            StmtTag::If => self.report(cx, FUNCTION_DECLARATIONS_IN_IF_STATEMENT_CLAUSES_WITHOUT_BLOCK, span),
            StmtTag::Labeled => self.report(cx, LABELLED_FUNCTION_DECLARATIONS, parent.span()),
            _ => {}
        }
    }

    fn for_in_or_of<'a>(&self, stmt: Stmt<'a>, cx: &mut Context<'a>) {
        let left = match stmt.kind() {
            StmtKind::ForOf { left, is_await, .. } => {
                self.report(cx, FOR_OF_LOOPS, stmt.span());
                if is_await {
                    self.report_of(cx, ASYNC_ITERATION, stmt.span(), listener(NODE, 1, 1));
                    if !is_in_function(Node::Stmt(stmt), &mut cx.state.function_around) {
                        self.report(cx, TOP_LEVEL_AWAIT, stmt.span());
                    }
                }
                left
            }
            StmtKind::ForIn { left, .. } => {
                if let StmtKind::Var(declarators) = left.kind()
                    && let Some(init) = declarators.first().and_then(VarDecl::init)
                {
                    self.report(cx, INITIALIZERS_IN_FOR_IN, init.span());
                }
                left
            }
            _ => return,
        };
        if let StmtKind::Expr(target) = left.kind()
            && matches!(target.tag(), ExprTag::Array | ExprTag::Object)
            && !target.is_parenthesized()
        {
            self.report(cx, DESTRUCTURING, target.span());
        }
    }

    fn try_statement<'a>(&self, stmt: Stmt<'a>, cx: &mut Context<'a>) {
        let StmtKind::Try {
            param,
            handler: Some(handler),
            ..
        } = stmt.kind()
        else {
            return;
        };
        let Some(param) = param else {
            if let Some(clause) = stmt.catch_clause_span() {
                self.report(cx, OPTIONAL_CATCH_BINDING, clause);
            }
            return;
        };
        if !self.active(&cx.state).is_some_and(|it| it.has(SHADOW_CATCH_PARAM)) {
            return;
        }
        let Some(name) = param.pat().as_ident() else {
            return;
        };
        let Some(shadowing) = Node::Pat(param.pat()).scope().variable_scope().get_name(name) else {
            return;
        };
        let declarators = cx.state.var_declarators.entry(shadowing).or_insert_with(|| {
            let declarators = shadowing.declarations().filter_map(|declaration| match declaration.node() {
                Some(Node::VarDecl(declarator)) if declaration.kind() == Some(DeclarationKind::Variable) => Some(declarator),
                _ => None,
            });
            let mut declarators: Vec<VarDecl<'a>> = declarators.filter(|it| it.var_kind() == VarKind::Var).collect();
            utils::sort::sort_by_key(&mut declarators, |it| it.binding_span().start);
            declarators
        });
        let handler = handler.span();
        let first = declarators.partition_point(|it| it.binding_span().start < handler.start);
        let in_handler = declarators.iter().skip(first).take_while(|it| it.binding_span().start < handler.end);
        let shadowed: smallvec::SmallVec<[Span; 2]> = in_handler.filter(|it| handler.contains(it.binding_span())).map(|it| it.span()).collect();
        for declarator in shadowed {
            self.report(cx, SHADOW_CATCH_PARAM, declarator);
        }
    }

    fn number<'a>(&self, literal: Literal<'a>, cx: &mut Context<'a>) {
        let (raw, span) = (literal.text(), literal.span());
        if strings::contains_char(raw, b'_') {
            self.report(cx, NUMERIC_SEPARATORS, span);
        }
        if literal.is_bigint() {
            return self.report(cx, BIGINT, span);
        }
        match raw {
            [b'0', b'b' | b'B', ..] => self.report(cx, BINARY_NUMERIC_LITERALS, span),
            [b'0', b'o' | b'O', ..] => self.report(cx, OCTAL_NUMERIC_LITERALS, span),
            _ => {}
        }
    }

    /// U+2028 and U+2029 in a string.
    fn string<'a>(&self, literal: Literal<'a>, cx: &mut Context<'a>) {
        let raw = literal.text();
        let mut from = 0;
        while let Some(found) = strings::index_of(&raw[from..], b"\xE2\x80") {
            let at = from + found;
            from = at + 2;
            let backslashes = raw[..at].iter().rev().take_while(|it| **it == b'\\').count();
            if matches!(raw.get(at + 2), Some(0xA8 | 0xA9)) && backslashes % 2 == 0 {
                let offset = literal.span().start + at as u32;
                self.report_with(cx, JSON_SUPERSET, Span::empty(offset), None, true, listener_of(JSON_SUPERSET));
            }
        }
    }

    /// `None`: it is not known.
    fn regexp<'a>(&self, cx: &Context<'a>, at: Span, pattern: Option<&[u8]>, flags: Option<&[u8]>) {
        let Some(active) = self.active(&cx.state) else {
            return;
        };
        for (feature, flag) in
            [(REGEXP_D_FLAG, b'd'), (REGEXP_S_FLAG, b's'), (REGEXP_U_FLAG, b'u'), (REGEXP_V_FLAG, b'v'), (REGEXP_Y_FLAG, b'y')]
        {
            if flags.is_some_and(|it| strings::contains_char(it, flag)) {
                self.report(cx, feature, at);
            }
        }
        // What all that is looked for starts with.
        let pattern = pattern.unwrap_or_default();
        if !active.has_regexp_pattern() || ![&b"(?<"[..], b"\\k", b"\\p", b"\\P"].iter().any(|it| strings::contains(pattern, it)) {
            return;
        }
        let mode = RegexMode {
            unicode: flags.is_some_and(|it| strings::contains_char(it, b'u')),
            unicode_sets: false,
        };
        let mut found = Pattern::default();
        if regex::validate_pattern(pattern, mode, regex::Options::default(), &mut found).is_err() {
            return;
        }
        let years = [
            REGEXP_UNICODE_PROPERTY_ESCAPES_2019,
            REGEXP_UNICODE_PROPERTY_ESCAPES_2020,
            REGEXP_UNICODE_PROPERTY_ESCAPES_2021,
            REGEXP_UNICODE_PROPERTY_ESCAPES_2022,
            REGEXP_UNICODE_PROPERTY_ESCAPES_2023,
        ];
        let all = [
            (REGEXP_LOOKBEHIND_ASSERTIONS, found.has_lookbehind),
            (REGEXP_NAMED_CAPTURE_GROUPS, found.has_named_group),
            (REGEXP_UNICODE_PROPERTY_ESCAPES, found.has_property_escape),
        ];
        for (feature, is_found) in all.into_iter().chain(years.into_iter().zip(found.has_property_of_year)) {
            if is_found {
                self.report(cx, feature, at);
            }
        }
    }

    fn modules<'a>(&self, cx: &Context<'a>) {
        let mut bodies = Bodies::new();
        bodies.push(cx.file().body());
        while let Some(body) = bodies.pop() {
            self.modules_in(cx, body, &mut bodies);
        }
    }

    /// `namespaces`: it gets the bodies of those in `body`.
    fn modules_in<'a>(&self, cx: &Context<'a>, body: List<'a, Stmt<'a>>, namespaces: &mut Bodies<'a>) {
        let literal = |name: Ident<'a>| name.is_string().then(|| name.span());
        for stmt in body {
            let mut names: smallvec::SmallVec<[Option<Span>; 4]> = smallvec::SmallVec::new();
            let span = match stmt.kind() {
                StmtKind::Import(import) => {
                    names.extend(import.named().iter().map(|it| literal(it.imported())));
                    Some(stmt.span())
                }
                StmtKind::ExportNamed(export) => {
                    names.extend(export.items().iter().flat_map(|it| [literal(it.local()), literal(it.exported())]));
                    Some(stmt.span())
                }
                StmtKind::ExportStar { alias, .. } => {
                    if alias.is_some() {
                        self.report(cx, EXPORT_NS_FROM, stmt.span());
                    }
                    names.push(alias.and_then(literal));
                    Some(stmt.span())
                }
                StmtKind::ExportDefault(_) => Some(stmt.span()),
                StmtKind::Module(module) => {
                    namespaces.push(module.innermost().body());
                    stmt.export_span()
                }
                _ => stmt.export_span(),
            };
            if let Some(span) = span {
                self.report(cx, MODULES, span);
            }
            for name in names.into_iter().flatten() {
                self.report(cx, ARBITRARY_MODULE_NAMESPACE_NAMES, name);
            }
        }
    }

    /// `\u{1F600}` in a name, a string or a template.
    fn unicode_codepoint_escapes<'a>(&self, cx: &Context<'a>) {
        let file = cx.file();
        for token in file.tokens() {
            let is_text = matches!(
                token.kind(),
                TokenKind::Identifier | TokenKind::Keyword | TokenKind::String | TokenKind::Template | TokenKind::PrivateIdentifier
            );
            let text = token.text();
            if !is_text || !strings::contains(text, b"\\u{") {
                continue;
            }
            let mut from = 0;
            while let Some(found) = strings::index_of(&text[from..], b"\\u{") {
                let at = from + found;
                from = at + 3;
                let digits = text[from..].iter().take_while(|it| it.is_ascii_hexdigit()).count();
                let backslashes = text[..at].iter().rev().take_while(|it| **it == b'\\').count();
                if digits > 0 && text.get(from + digits) == Some(&b'}') && backslashes % 2 == 0 {
                    let start = token.start() + at as u32;
                    self.report(cx, UNICODE_CODEPOINT_ESCAPES, Span::new(start, start + 4 + digits as u32));
                }
            }
        }
    }

    fn subclassing_builtins<'a>(&self, cx: &Context<'a>, tracker: &ReferenceTracker<'a>) {
        const READ: TraceMap<'static, ()> = TraceMap::EMPTY.read(());
        const BUILTINS: TraceMap<'static, ()> = TraceMap::new(&[
            ("Array", READ),
            ("Boolean", READ),
            ("Error", READ),
            ("RegExp", READ),
            ("Function", READ),
            ("Map", READ),
            ("Number", READ),
            ("Promise", READ),
            ("Set", READ),
            ("String", READ),
        ]);
        if !cx.has_classes() {
            return;
        }
        for reference in tracker.iterate_global_references(&BUILTINS) {
            if let Some(e) = reference.expr()
                && matches!(e.parent(), Node::Class(class) if class.extends() == Some(e))
            {
                self.report(cx, SUBCLASSING_BUILTINS, reference.span);
            }
        }
    }

    fn error_cause<'a>(&self, cx: &Context<'a>, tracker: &ReferenceTracker<'a>) {
        const ERROR: TraceMap<'static, ()> = TraceMap::EMPTY.construct(()).read(());
        const ERRORS: TraceMap<'static, ()> = TraceMap::new(&[
            ("Error", ERROR),
            ("EvalError", ERROR),
            ("RangeError", ERROR),
            ("ReferenceError", ERROR),
            ("SyntaxError", ERROR),
            ("TypeError", ERROR),
            ("URIError", ERROR),
            ("AggregateError", ERROR),
        ]);
        // `isConstructCallWithCauseOption`, for what is a `new` expression or a call of `super`.
        let has_cause_option = |call: Call<'a>, is_aggregate_error: bool| {
            let at = if is_aggregate_error { 2 } else { 1 };
            if call.args().iter().take(at).any(|it| it.tag() == ExprTag::Spread) {
                return false;
            }
            let Some(ExprKind::Object(properties)) = call.args().get(at).map(Expr::kind) else {
                return false;
            };
            properties.iter().any(|it| {
                it.kind() != PropKind::Spread && get_property_name(it, Some(Node::Prop(it).scope())).is_some_and(|name| &name[..] == b"cause")
            })
        };
        // The calls of `super` with the option, each with its class.
        let mut subclasses: Vec<(Class<'a>, Expr<'a>, [bool; 2])> = Vec::new();
        for e in cx.file().exprs_of_kind(ExprTag::Super) {
            if let Node::Expr(super_call) = e.parent()
                && let ExprKind::Call(call) = super_call.kind()
                && call.callee() == e
                && let found = [has_cause_option(call, false), has_cause_option(call, true)]
                && found != [false, false]
                && let Some(class) = Node::Expr(super_call).enclosing_class().filter(|it| it.extends().is_some())
            {
                subclasses.push((class, super_call, found));
            }
        }
        utils::sort::sort_by_key(&mut subclasses, |it| it.1.span().start);
        // The first for what a class extends, and for whether that is `AggregateError`.
        let mut first_of_subclass: FxHashMap<(Expr<'a>, bool), Expr<'a>> = FxHashMap::default();
        for (class, super_call, found) in subclasses {
            for is_aggregate_error in [false, true] {
                if found[usize::from(is_aggregate_error)]
                    && let Some(extended) = class.extends()
                {
                    first_of_subclass.entry((extended, is_aggregate_error)).or_insert(super_call);
                }
            }
        }
        for reference in tracker.iterate_global_references(&ERRORS) {
            let Some(node) = reference.expr() else {
                continue;
            };
            let is_aggregate_error = reference.path[..] == ["AggregateError"];
            let reported = match first_of_subclass.get(&(node, is_aggregate_error)) {
                Some(super_call) => Some(*super_call),
                None => (reference.kind == ReferenceKind::Construct || node.tag() == ExprTag::New)
                    .then(|| reference.call().filter(|call| has_cause_option(*call, is_aggregate_error)).map(|_| node))
                    .flatten(),
            };
            if let Some(reported) = reported {
                self.report(cx, ERROR_CAUSE, reported.span());
            }
        }
    }
}
