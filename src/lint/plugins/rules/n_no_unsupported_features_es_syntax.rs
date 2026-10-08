use crate::n::es_syntax::{Active, FEATURES};
use crate::n::es_syntax_data::*;
use crate::n::object_type::ExpressionTypes;
use crate::n::semver::Range;
use crate::n::{configured_node_version, version_range};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::regex::{self, Handler, Mode as RegexMode};
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::eslint_utils::{ReferenceKind, ReferenceTracker, TraceMap, get_property_name, get_string_if_constant};
use rustc_hash::FxHashMap;
use std::cell::RefCell;
use std::sync::OnceLock;

/// Disallow unsupported ECMAScript syntax on the specified version.
///
/// What finds a feature is the rule of eslint-plugin-es-x for it.
pub struct EsSyntax {
    version: Option<Range>,
    ignores: Vec<Box<[u8]>>,
    /// For the first range of versions that was asked for: that of the options, or else what the first file has.
    first: OnceLock<Active>,
}

const NOT_SUPPORTED_TILL: Message = Message::new(
    "not-supported-till",
    "'{{featureName}}' is not supported until Node.js {{supported}}. The configured version range is '{{version}}'.",
);
const NOT_SUPPORTED_YET: Message = Message::new(
    "not-supported-yet",
    "'{{featureName}}' is not supported in Node.js. The configured version range is '{{version}}'.",
);

#[derive(Default)]
pub struct State<'a> {
    /// If the file has another range of versions than [`EsSyntax::first`] is for.
    own: Option<Box<Active>>,
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

impl Rule for EsSyntax {
    const META: Meta = Meta::plugin(Plugin::Node, "no-unsupported-features/es-syntax", Kind::Problem).recommended();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        EsSyntax {
            version: version_range(options.get(0)),
            ignores: options.object(0).strings("ignores").iter().map(|it| it.as_bytes().into()).collect(),
            first: OnceLock::new(),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> State<'a> {
        let version = || self.version.clone().unwrap_or_else(|| configured_node_version(file));
        let first = self.first.get_or_init(|| Active::new(version(), &self.ignores));
        let own = match &self.version {
            Some(_) => None,
            None => Some(version()).filter(|it| it.raw != first.version.raw).map(|it| Box::new(Active::new(it, &self.ignores))),
        };
        let active = own.as_deref().unwrap_or(first);
        let any = |features: &[usize]| features.iter().any(|&it| active.has(it));

        if any(&[ARROW_FUNCTIONS, ASYNC_FUNCTIONS, ASYNC_ITERATION, GENERATORS, TRAILING_FUNCTION_COMMAS]) {
            on.funcs(Self::func);
        }
        if any(&[DEFAULT_PARAMETERS, REST_PARAMETERS, DESTRUCTURING]) {
            on.params(Self::param);
        }
        if active.has(CLASSES) {
            on.classes(|rule, class, cx| rule.report_in(cx, CLASSES, class.estree_span(), Node::Class(class)));
        }
        if any(&[ACCESSOR_PROPERTIES, COMPUTED_PROPERTIES, CLASS_FIELDS, CLASS_STATIC_BLOCK]) {
            on.members(Self::member);
        }
        if any(&[ACCESSOR_PROPERTIES, COMPUTED_PROPERTIES, KEYWORD_PROPERTIES, PROPERTY_SHORTHANDS, REST_SPREAD_PROPERTIES]) {
            on.props(Self::prop);
        }
        if any(&[COMPUTED_PROPERTIES, KEYWORD_PROPERTIES, REST_SPREAD_PROPERTIES]) {
            on.nodes(NodeTags::PAT_PROP, Self::pat_prop);
        }
        if any(&[DESTRUCTURING, TRAILING_COMMAS]) {
            on.pats([PatTag::Array, PatTag::Object], Self::pat);
        }
        if active.has(TRAILING_COMMAS) {
            on.exprs([ExprTag::Array, ExprTag::Object], |rule, e, cx| {
                if comma_before(cx.file(), e.span().end - 1).is_some() {
                    rule.report(cx, TRAILING_COMMAS, e.span());
                }
            });
        }
        if any(&[EXPONENTIAL_OPERATORS, LOGICAL_ASSIGNMENT_OPERATORS, DESTRUCTURING]) {
            on.exprs([ExprTag::Assign], Self::assign);
        }
        if active.has(EXPONENTIAL_OPERATORS) {
            on.binaries([BinOp::Pow], |rule, e, cx| rule.report(cx, EXPONENTIAL_OPERATORS, e.span()));
        }
        if active.has(NULLISH_COALESCING_OPERATORS) {
            on.binaries([BinOp::Nullish], |rule, e, cx| {
                if let Some(operator) = e.operator_span() {
                    rule.report(cx, NULLISH_COALESCING_OPERATORS, operator);
                }
            });
        }
        for (feature, tag) in [(DYNAMIC_IMPORT, ExprTag::ImportCall), (IMPORT_META, ExprTag::ImportMeta), (NEW_TARGET, ExprTag::NewTarget)] {
            if active.has(feature) {
                on.exprs([tag], |rule, e, cx| {
                    let feature = match e.tag() {
                        ExprTag::ImportCall => DYNAMIC_IMPORT,
                        ExprTag::ImportMeta => IMPORT_META,
                        _ => NEW_TARGET,
                    };
                    rule.report(cx, feature, e.span());
                });
            }
        }
        if active.has(SPREAD_ELEMENTS) {
            on.exprs([ExprTag::Spread], |rule, e, cx| {
                let is_element = match e.parent() {
                    Node::Expr(parent) => match parent.tag() {
                        ExprTag::Array => !parent.is_assignment_target(),
                        ExprTag::Call | ExprTag::New => true,
                        _ => false,
                    },
                    _ => false,
                };
                if is_element {
                    rule.report(cx, SPREAD_ELEMENTS, e.span());
                }
            });
        }
        if any(&[TEMPLATE_LITERALS, MALFORMED_TEMPLATE_LITERALS]) {
            on.exprs([ExprTag::Template, ExprTag::TaggedTemplate], Self::template);
        }
        if active.has(TOP_LEVEL_AWAIT) {
            on.exprs([ExprTag::Await], |rule, e, cx| {
                if !is_in_function(Node::Expr(e), &mut cx.state.function_around) {
                    rule.report(cx, TOP_LEVEL_AWAIT, e.span());
                }
            });
        }
        if any(&[TRAILING_FUNCTION_COMMAS, OPTIONAL_CHAINING]) {
            on.exprs([ExprTag::Call, ExprTag::New], Self::call);
        }
        let mut methods = smallvec::SmallVec::new();
        for (at, &(method, ..)) in active.methods.iter().enumerate() {
            if active.methods.get(at.wrapping_sub(1)).is_none_or(|it| it.0 != method) && file.mentions(method) {
                methods.push(file.name_of(method));
            }
        }
        if !methods.is_empty() || any(&[OPTIONAL_CHAINING, KEYWORD_PROPERTIES, CLASS_FIELDS, LEGACY_OBJECT_PROTOTYPE_ACCESSOR_METHODS]) {
            on.exprs([ExprTag::Dot, ExprTag::Index], Self::member_expression);
        }
        if any(&[CLASS_FIELDS, PRIVATE_IN]) {
            on.exprs([ExprTag::PrivateIdentifier], |rule, e, cx| {
                rule.report(cx, CLASS_FIELDS, e.span());
                rule.report(cx, PRIVATE_IN, e.span());
            });
        }
        if active.has(OBJECT_SUPER_PROPERTIES) {
            on.exprs([ExprTag::Super], |rule, e, cx| {
                // The function that it is in, not counting arrow functions.
                let with_this = |it: Node<'a>| it.as_func().filter(|it| is_function(*it) && !it.is_arrow());
                let func = cx.state.function_with_this_around.find(Node::Expr(e), |_, parent| with_this(parent));
                let is_in_object_method = func.is_some_and(|func| match func.owner() {
                    Node::Expr(owner) => matches!(owner.parent(), Node::Prop(prop) if prop.kind() == PropKind::Method),
                    _ => false,
                });
                if is_in_object_method {
                    rule.report(cx, OBJECT_SUPER_PROPERTIES, e.span());
                }
            });
        }
        if active.has_regexp() {
            on.exprs([ExprTag::Regex], |rule, e, cx| {
                if let ExprKind::Regex(literal) = e.kind() {
                    rule.regexp(cx, e.span(), Some(literal.pattern()), Some(literal.flags()));
                }
            });
        }
        if active.has(BLOCK_SCOPED_VARIABLES) {
            on.stmts([StmtTag::Var], |rule, stmt, cx| {
                if let StmtKind::Var(declarators) = stmt.kind()
                    && matches!(declarators.first().map(VarDecl::var_kind), Some(VarKind::Let | VarKind::Const))
                {
                    rule.report_in(cx, BLOCK_SCOPED_VARIABLES, stmt.span_without_export(), Node::Stmt(stmt));
                }
            });
        }
        if any(&[
            BLOCK_SCOPED_FUNCTIONS,
            FUNCTION_DECLARATIONS_IN_IF_STATEMENT_CLAUSES_WITHOUT_BLOCK,
            LABELLED_FUNCTION_DECLARATIONS,
        ]) {
            on.stmts([StmtTag::Fn], Self::function_declaration);
        }
        if any(&[FOR_OF_LOOPS, ASYNC_ITERATION, TOP_LEVEL_AWAIT, DESTRUCTURING, INITIALIZERS_IN_FOR_IN]) {
            on.stmts([StmtTag::ForOf, StmtTag::ForIn], Self::for_in_or_of);
        }
        if any(&[OPTIONAL_CATCH_BINDING, SHADOW_CATCH_PARAM]) {
            on.stmts([StmtTag::Try], Self::try_statement);
        }
        if any(&[BIGINT, BINARY_NUMERIC_LITERALS, OCTAL_NUMERIC_LITERALS, NUMERIC_SEPARATORS]) {
            on.number_literals(Self::number);
        }
        if active.has(JSON_SUPERSET) && strings::contains(file.text(), b"\xE2\x80") {
            on.string_literals(Self::string);
        }
        let has_something_at_the_end = active.globals_in(file).next().is_some()
            || active.has_regexp() && file.mentions("RegExp")
            || active.has(ERROR_CAUSE) && file.mentions("cause")
            || active.has(RESIZABLE_AND_GROWABLE_ARRAYBUFFERS) && file.mentions_any(&["ArrayBuffer", "SharedArrayBuffer"])
            || any(&[
                HASHBANG,
                MODULES,
                EXPORT_NS_FROM,
                ARBITRARY_MODULE_NAMESPACE_NAMES,
                UNICODE_CODEPOINT_ESCAPES,
                LEGACY_OBJECT_PROTOTYPE_ACCESSOR_METHODS,
                SUBCLASSING_BUILTINS,
            ]);
        if has_something_at_the_end {
            on.finish(Self::finish);
        }
        State {
            own,
            methods,
            types: RefCell::default(),
            var_declarators: FxHashMap::default(),
            function_around: AncestorMemo::default(),
            function_with_this_around: AncestorMemo::default(),
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
    fn active<'s>(&'s self, state: &'s State<'_>) -> Option<&'s Active> {
        state.own.as_deref().or_else(|| self.first.get())
    }

    fn report<'a>(&self, cx: &Context<'a>, feature: usize, at: Span) {
        self.report_with(cx, feature, at, None, false);
    }

    /// For a feature that was supported in strict mode first. `node`: what is reported.
    fn report_in<'a>(&self, cx: &Context<'a>, feature: usize, at: Span, node: Node<'a>) {
        self.report_with(cx, feature, at, Some(node), false);
    }

    fn report_with<'a>(&self, cx: &Context<'a>, feature: usize, at: Span, node: Option<Node<'a>>, is_position: bool) {
        let Some(active) = self.active(&cx.state).filter(|it| it.has(feature)) else {
            return;
        };
        let Some(data) = FEATURES.get(feature) else {
            return;
        };
        let mut supported = data.supported_range();
        if let (Some(strict_mode), Some(node)) = (data.strict_mode, node) {
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
        let message = if data.supported.is_none() { NOT_SUPPORTED_YET } else { NOT_SUPPORTED_TILL };
        let report = if is_position { cx.report_at(at.start, message) } else { cx.report(at, message) };
        report.data("featureName", data.name).data("supported", supported).data("version", active.version.raw.clone());
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

    fn member<'a>(&self, member: Member<'a>, cx: &mut Context<'a>) {
        if !matches!(member.parent(), Node::Class(_)) || member.flags().contains(Flags::ABSTRACT) {
            return;
        }
        let key = member.key();
        let key_span = key.map(|it| it.inner_span(cx.file()));
        match member.kind() {
            MemberKind::StaticBlock => self.report(cx, CLASS_STATIC_BLOCK, member.span()),
            MemberKind::Property if !member.flags().intersects(Flags::AMBIENT | Flags::ACCESSOR) => {
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

    fn pat_prop<'a>(&self, node: Node<'a>, cx: &mut Context<'a>) {
        let Node::PatProp(prop) = node else {
            return;
        };
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

    fn assign<'a>(&self, e: Expr<'a>, cx: &mut Context<'a>) {
        let ExprKind::Assign { op, target, .. } = e.kind() else {
            return;
        };
        match op {
            Some(BinOp::Pow) => self.report(cx, EXPONENTIAL_OPERATORS, e.span()),
            Some(BinOp::And | BinOp::Or | BinOp::Nullish) => {
                if let Some(operator) = e.operator_span() {
                    self.report(cx, LOGICAL_ASSIGNMENT_OPERATORS, operator);
                }
            }
            None if matches!(target.tag(), ExprTag::Array | ExprTag::Object) && !target.is_parenthesized() && !e.is_assignment_target() => {
                self.report(cx, DESTRUCTURING, target.span());
            }
            _ => {}
        }
    }

    fn template<'a>(&self, e: Expr<'a>, cx: &mut Context<'a>) {
        let ExprKind::Template(template) = e.kind() else {
            return self.report(cx, TEMPLATE_LITERALS, e.span());
        };
        let is_tagged = matches!(e.parent(), Node::Expr(parent) if matches!(parent.kind(), ExprKind::TaggedTemplate(call) if call.template() == Some(e)));
        if !is_tagged {
            return self.report(cx, TEMPLATE_LITERALS, e.span());
        }
        if (0..template.quasi_count()).any(|i| template.cooked(i).is_none()) {
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
                self.report(cx, KEYWORD_PROPERTIES, e.span());
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
                    self.report(cx, ASYNC_ITERATION, stmt.span());
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
            declarators.sort_by_key(|it| it.binding_span().start);
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
                self.report_with(cx, JSON_SUPERSET, Span::empty(offset), None, true);
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

    fn finish<'a>(&self, cx: &mut Context<'a>) {
        const REGEXP: TraceMap<'static, ()> = TraceMap::new(&[("RegExp", TraceMap::EMPTY.call(()).construct(()))]);
        let file = cx.file();
        let Some(active) = self.active(&cx.state) else {
            return;
        };
        let tracker = ReferenceTracker::new(file);
        for feature in active.globals_in(file) {
            for reference in tracker.iterate_global_references(&FEATURES[feature].globals) {
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
    }

    fn modules<'a>(&self, cx: &Context<'a>) {
        let literal = |name: Ident<'a>| name.is_string().then(|| name.span());
        for stmt in cx.file().body() {
            let mut names: smallvec::SmallVec<[Option<Span>; 4]> = smallvec::SmallVec::new();
            let span = match stmt.kind() {
                StmtKind::Import(import) => {
                    names.extend(import.named().iter().map(|it| literal(it.imported())));
                    Some(stmt.span())
                }
                StmtKind::ExportNamed(export) => {
                    names.extend(export.items().iter().flat_map(|it| [literal(it.local()), literal(it.exported()).filter(|_| it.is_renamed())]));
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

    fn subclassing_builtins<'a>(&self, cx: &Context<'a>, tracker: &ReferenceTracker<'a, '_>) {
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

    fn error_cause<'a>(&self, cx: &Context<'a>, tracker: &ReferenceTracker<'a, '_>) {
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
        subclasses.sort_by_key(|it| it.1.span().start);
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
