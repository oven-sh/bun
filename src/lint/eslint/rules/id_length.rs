use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::source::ByName;
use bun_lint::utils::ast_utils::{is_function_with_body, is_import_attribute_key};
use bun_lint::utils::estree_compat::is_assignment_target;
use bun_lint::utils::string_utils::get_grapheme_count;

/// Enforce minimum and maximum identifier lengths.
pub struct IdLength {
    min: f64,
    max: f64,
    properties: bool,
    exceptions: Vec<Box<[u8]>>,
    exception_patterns: Vec<Regex>,
    /// An option of oxlint.
    check_generic: bool,
    /// A name that starts with so many letters of ASCII has the right length, whatever follows them.
    /// `usize::MAX`: no start tells.
    enough: usize,
}

const TOO_SHORT: Message = Message::new(
    "tooShort",
    "Identifier name '{{name}}' is too short (< {{min}}).",
);
const TOO_SHORT_PRIVATE: Message = Message::new(
    "tooShortPrivate",
    "Identifier name '#{{name}}' is too short (< {{min}}).",
);
const TOO_LONG: Message = Message::new(
    "tooLong",
    "Identifier name '{{name}}' is too long (> {{max}}).",
);
const TOO_LONG_PRIVATE: Message = Message::new(
    "tooLongPrivate",
    "Identifier name '#{{name}}' is too long (> {{max}}).",
);

/// ESTree's `key.name`: the name of a key that is an `Identifier`, in brackets or not.
pub(super) fn key_identifier(key: Key<'_>) -> Option<Name<'_>> {
    match key.kind() {
        KeyKind::Ident(name) => Some(name),
        KeyKind::Computed(e) => e.as_ident(),
        _ => None,
    }
}

/// Whether `head` is the `left` of the `for`-`in` or `for`-`of` loop `statement`.
fn is_head_of<'a>(head: Stmt<'a>, statement: Stmt<'a>) -> bool {
    matches!(
        statement.kind(),
        StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } if left == head
    )
}

/// Whether `e` is the `left` of an assignment, of a default value in a pattern, or of a `for`-`in`
/// or a `for`-`of` loop.
fn is_left(e: Expr) -> bool {
    match e.parent() {
        Node::Expr(parent) => parent.as_assign().is_some_and(|(_, target, _)| target == e),
        Node::Stmt(parent) => match parent.kind() {
            StmtKind::Expr(_) => parent
                .parent()
                .as_stmt()
                .is_some_and(|it| is_head_of(parent, it)),
            StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } => {
                left.as_expr() == Some(e)
            }
            _ => false,
        },
        _ => false,
    }
}

/// Whether `member`, an `a.b`, is what an assignment expression assigns to, or the value of a
/// property of an object pattern that is not inside another pattern.
fn is_assigned_member(member: Expr) -> bool {
    match member.parent() {
        Node::Expr(parent) => match parent.kind() {
            ExprKind::Assign { op, target, .. } => {
                target == member && (op.is_some() || !is_assignment_target(parent))
            }
            _ => false,
        },
        Node::Prop(prop) => {
            prop.kind() == PropKind::Init
                && prop.value() == Some(member)
                && matches!(prop.parent(), Node::Expr(object) if is_left(object))
        }
        _ => false,
    }
}

/// Whether `member` is a `MethodDefinition` or a `PropertyDefinition` of ESTree.
fn is_definition(member: Member) -> bool {
    let flags = member.flags();
    !flags.contains(Flags::ABSTRACT)
        && !member.is_signature()
        && match member.kind() {
            MemberKind::Property => !flags.contains(Flags::ACCESSOR),
            MemberKind::Method
            | MemberKind::Getter
            | MemberKind::Setter
            | MemberKind::Constructor => true,
            _ => false,
        }
}

impl IdLength {
    /// Whether the name that `text` starts with has the right length by [`IdLength::enough`].
    #[inline]
    fn is_right_by_its_start(&self, text: &[u8]) -> bool {
        text.get(..self.enough)
            .is_some_and(|it| it.iter().all(u8::is_ascii_alphabetic))
    }

    /// The same for the name that is written at `start`.
    #[inline]
    fn is_right_at(&self, file: &File, start: u32) -> bool {
        file.text()
            .get(start as usize..)
            .is_some_and(|it| self.is_right_by_its_start(it))
    }

    /// What to report about an identifier named `name`, which is without its `#`, and the limit that the message names.
    fn problem(&self, name: &[u8], is_private: bool) -> Option<(Message, &'static str, f64)> {
        if self.is_right_by_its_start(name) {
            return None;
        }
        let length = get_grapheme_count(name) as f64;
        let problem = if length < self.min {
            (
                if is_private {
                    TOO_SHORT_PRIVATE
                } else {
                    TOO_SHORT
                },
                "min",
                self.min,
            )
        } else if length > self.max {
            (
                if is_private {
                    TOO_LONG_PRIVATE
                } else {
                    TOO_LONG
                },
                "max",
                self.max,
            )
        } else {
            return None;
        };
        let is_exception = self.exceptions.iter().any(|it| **it == *name)
            || self.exception_patterns.iter().any(|it| it.test(name));
        (!is_exception).then_some(problem)
    }

    /// Reports an identifier named `name` if its length is wrong. `at` is only asked then: where
    /// to report it, or `None` if it is not in a place that the rule looks at.
    #[inline]
    fn check<'a>(&self, cx: &mut Cx<'a, Self>, name: Name<'a>, at: impl Fn() -> Option<Span>) {
        if cx
            .state
            .get_or_insert_with(name, || self.problem_of(name).1.is_some())
        {
            self.report(cx, name, &at);
        }
    }

    /// `name` without its `#`, and its [`IdLength::problem`].
    #[inline(never)]
    fn problem_of<'a>(&self, name: Name<'a>) -> (&'a [u8], Option<(Message, &'static str, f64)>) {
        match name.bytes() {
            [b'#', rest @ ..] => (rest, self.problem(rest, true)),
            name => (name, self.problem(name, false)),
        }
    }

    /// What few names come to is not in the listeners.
    #[inline(never)]
    fn report<'a>(&self, cx: &Cx<'a, Self>, name: Name<'a>, at: &dyn Fn() -> Option<Span>) {
        if let (name, Some((message, limit, value))) = self.problem_of(name)
            && let Some(at) = at()
        {
            let report = cx.report(at, message).called_with_the_name();
            report
                .data("name", name)
                .data(limit, text::number_to_string(value));
        }
    }

    /// The value `value`, named `name`, of a property of an object pattern with the key `key`.
    fn property_of_pattern<'a>(
        &self,
        file: &File<'a>,
        key: Key<'a>,
        name: Name<'a>,
        value: Span,
    ) -> Option<Span> {
        match key_identifier(key) == Some(name) {
            true => self.properties.then(|| key.inner_span(file)),
            false => Some(value),
        }
    }

    #[inline]
    fn check_binding<'a>(&self, pat: Pat<'a>, cx: &mut Cx<'a, Self>) {
        let Some(name) = pat.as_ident() else {
            return;
        };
        let file = cx.file();
        self.check(cx, name, || match pat.parent() {
            Node::VarDecl(declaration) => Some(declaration.binding_span()),
            Node::Param(param) if param.is_rest() => Some(pat.span()),
            Node::Param(param) => {
                let is_supported = param.default().is_some()
                    || !param.is_parameter_property()
                        && param.func().is_some_and(is_function_with_body);
                is_supported.then(|| param.binding_span())
            }
            Node::PatElem(_) => Some(pat.span()),
            Node::PatProp(prop) if prop.is_rest() || prop.default().is_some() => Some(pat.span()),
            Node::PatProp(prop) => self.property_of_pattern(file, prop.key()?, name, pat.span()),
            _ => None,
        });
    }

    #[inline]
    fn check_reference<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(name) = e.as_ident() else {
            return;
        };
        let file = cx.file();
        self.check(cx, name, || {
            let is_supported = match e.parent() {
                Node::Expr(parent) => match parent.kind() {
                    ExprKind::Dot { .. } => self.properties && is_assigned_member(parent),
                    ExprKind::Assign {
                        op: None, target, ..
                    } => target == e && is_assignment_target(parent),
                    ExprKind::Array(_) | ExprKind::Spread(_) => is_assignment_target(parent),
                    _ => false,
                },
                Node::Func(func) => matches!(func.body(), FnBody::Expr(body) if body == e),
                Node::Class(class) => {
                    class.extends() == Some(e) && matches!(class.owner(), Node::Stmt(_))
                }
                Node::Member(member) => {
                    let is_key = matches!(member.key()?.kind(), KeyKind::Computed(key) if key == e);
                    (is_key || member.init() == Some(e)) && is_definition(member)
                }
                Node::Prop(prop) => {
                    if prop.is_jsx_attribute() || prop.value() != Some(e) {
                        return None;
                    }
                    let Node::Expr(object) = prop.parent() else {
                        return None;
                    };
                    match (prop.kind(), is_assignment_target(object)) {
                        (PropKind::Spread, true) => true,
                        (PropKind::Shorthand, true) => self.properties,
                        (PropKind::Init, true) => {
                            return self.property_of_pattern(file, prop.key()?, name, e.span());
                        }
                        // `check_property` reports the key, which for a shorthand is the value.
                        (PropKind::Init, false) => {
                            self.properties
                                && matches!(prop.key()?.kind(), KeyKind::Ident(key) if key == name)
                        }
                        _ => false,
                    }
                }
                _ => false,
            };
            is_supported.then(|| e.span())
        });
    }

    /// The key of a property of an object literal.
    #[inline]
    fn check_property<'a>(&self, prop: Prop<'a>, cx: &mut Cx<'a, Self>) {
        let Some(key) = prop.key() else {
            return;
        };
        let KeyKind::Ident(name) = key.kind() else {
            return;
        };
        let file = cx.file();
        self.check(cx, name, || {
            // For oxlint the options of `import("a", { with: { type: "json" } })` are an object like another.
            let is_attribute = match file.language().is_oxlint {
                true => prop.is_import_attribute(),
                false => is_import_attribute_key(prop),
            };
            let is_supported = !prop.is_jsx_attribute()
                && !is_attribute
                && matches!(prop.parent(), Node::Expr(object) if !is_assignment_target(object));
            is_supported.then(|| key.span(file))
        });
    }

    /// The keys of `{ with: { key: "" } }` in `import("m", { with: { key: "" } })`, which ESLint has
    /// as an object literal.
    #[inline(never)]
    fn check_import_type<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        let Some(attributes) = ty.import_attributes() else {
            return;
        };
        let (file, keyword) = (cx.file(), attributes.keyword_span());
        let is_assert = file.slice(keyword) == b"assert";
        self.check(
            cx,
            file.name_of(if is_assert { "assert" } else { "with" }),
            || Some(keyword),
        );
        for key in attributes.entries().iter().filter_map(Prop::key) {
            if let KeyKind::Ident(name) = key.kind() {
                self.check(cx, name, || Some(key.span(file)));
            }
        }
    }

    #[inline]
    fn check_member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(key) = member.key() {
            if let KeyKind::Ident(name) | KeyKind::Private(name) = key.kind() {
                let file = cx.file();
                self.check(cx, name, || is_definition(member).then(|| key.span(file)));
            }
        } else if let Some(keyword) = member.constructor_keyword()
            && !keyword.is_string()
        {
            self.check(cx, keyword.name(), || {
                is_definition(member).then(|| keyword.span())
            });
        }
    }
}

/// The rule of oxlint 1.87 is another one. It looks at every name that is declared, in types too, at every private name
/// wherever it is written, and at the names of properties and members, but at no reference to a variable.
impl IdLength {
    #[inline]
    fn check_ident<'a>(&self, name: Ident<'a>, cx: &mut Cx<'a, Self>) {
        if !self.is_right_at(cx.file(), name.start()) && !name.is_string() {
            self.check(cx, name.name(), || Some(name.span()));
        }
    }

    #[inline]
    fn check_key<'a>(&self, key: Option<Key<'a>>, cx: &mut Cx<'a, Self>) {
        if let Some(key) = key
            && let KeyKind::Ident(name) | KeyKind::Private(name) = key.kind()
        {
            let file = cx.file();
            self.check(cx, name, || Some(key.span(file)));
        }
    }

    #[inline]
    fn check_binding_as_oxlint<'a>(&self, pat: Pat<'a>, cx: &mut Cx<'a, Self>) {
        let Some(name) = pat.as_ident() else {
            return;
        };
        self.check(cx, name, || match pat.parent() {
            Node::Param(param)
                if param
                    .func()
                    .is_some_and(|it| it.kind() == FnKind::IndexSignature) =>
            {
                None
            }
            Node::Param(_) if name.is("this") => None,
            // `{ a }`
            Node::PatProp(prop)
                if prop.is_shorthand() && prop.default().is_none() && !self.properties =>
            {
                None
            }
            _ => Some(pat.span()),
        });
    }

    /// The keys of an object pattern, but for `{ a: b }` and `{ a: { b } }`. `{ a = 1 }` is reported twice.
    #[inline(never)]
    fn check_keys_of_pattern<'a>(&self, pat: Pat<'a>, cx: &mut Cx<'a, Self>) {
        let PatKind::Object(props) = pat.kind() else {
            return;
        };
        for prop in props {
            if prop.default().is_some() || prop.value().tag() == PatTag::Array {
                self.check_key(prop.key().filter(|it| !it.is_private()), cx);
            }
        }
    }

    #[inline]
    fn check_member_as_oxlint<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        if !self.properties && !matches!(member.parent(), Node::Class(_)) {
            return;
        }
        match member.key() {
            None => {
                if let Some(keyword) = member.constructor_keyword() {
                    self.check_ident(keyword, cx);
                }
            }
            key => self.check_key(key, cx),
        }
    }

    #[inline(never)]
    fn check_statement_as_oxlint<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let names = match statement.kind() {
            StmtKind::Interface(it) => [Some(it.name()), None],
            StmtKind::TypeAlias(it) => [Some(it.name()), None],
            StmtKind::Enum(it) => [Some(it.name()), None],
            StmtKind::ImportEquals(it) => {
                // The `b` and the `c` of `import x = a.b.c`.
                if let ImportEqualsTarget::Entity(target) = it.target() {
                    for name in target.parts().skip(1) {
                        self.check_ident(name, cx);
                    }
                }
                [Some(it.name()), None]
            }
            StmtKind::ExportAsNamespace(_) => [statement.namespace_export_name(), None],
            StmtKind::ExportStar { alias, .. } => [alias, None],
            StmtKind::Import(it) => [it.default(), it.namespace()],
            StmtKind::Module(it) => {
                // `namespace A.B {}` is one statement.
                let mut at = Some(it);
                while let Some(module) = at {
                    if let ModuleName::Ident(name) = module.name() {
                        self.check_ident(name, cx);
                    }
                    at = module.nested();
                }
                [None, None]
            }
            _ => [None, None],
        };
        for name in names.into_iter().flatten() {
            self.check_ident(name, cx);
        }
    }

    /// `e`: the target of an assignment, or the value of a property, which can be one of an object pattern. There are far
    /// fewer of these than there are `a.b`.
    #[inline]
    fn check_assigned<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(start) = e.member_name_start()
            && !self.is_right_at(cx.file(), start)
            // The rule of oxlint comes to a private name on its own.
            && !(cx.language().is_oxlint && e.is_private_member())
        {
            self.check_member_expression(e, cx);
        }
    }

    #[inline(never)]
    fn check_member_expression<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(name) = e.member_name() else {
            return;
        };
        match cx.language().is_oxlint {
            true => self.check_member_expression_as_oxlint(e, name, cx),
            false => self.check(cx, name.name(), || {
                is_assigned_member(e).then(|| name.span())
            }),
        }
    }

    /// `a.b`: a private name, or what an assignment or a property of an object pattern assigns to.
    fn check_member_expression_as_oxlint<'a>(
        &self,
        e: Expr<'a>,
        name: Ident<'a>,
        cx: &mut Cx<'a, Self>,
    ) {
        self.check(cx, name.name(), || {
            let is_assigned_to = || match e.parent() {
                Node::Expr(parent) => parent.as_assign().is_some_and(|(_, target, _)| target == e),
                Node::Prop(prop) => {
                    prop.kind() == PropKind::Init
                        && prop.value() == Some(e)
                        && matches!(prop.parent(), Node::Expr(object) if is_assignment_target(object))
                }
                _ => false,
            };
            (name.bytes().starts_with(b"#") || self.properties && is_assigned_to()).then(|| name.span())
        });
    }

    /// The names in types that refer to no variable.
    #[inline(never)]
    fn check_type_as_oxlint<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        match ty.kind() {
            TypeKind::Tuple(elements) => {
                for name in elements.iter().filter_map(|it| it.name()) {
                    self.check_ident(name, cx);
                }
            }
            TypeKind::Ref { name, .. } if name.len() > 1 => {
                for name in name.parts().skip(1) {
                    self.check_ident(name, cx);
                }
            }
            TypeKind::Import { name, .. } => {
                for name in name.parts() {
                    self.check_ident(name, cx);
                }
            }
            TypeKind::Typeof { expr, .. } => {
                let mut at = expr;
                while let ExprKind::Dot { obj, name, .. } = at.kind() {
                    self.check_ident(name, cx);
                    at = obj;
                }
            }
            TypeKind::Predicate { .. } => {
                if let Some(param) = ty.predicate_param().filter(|it| !it.name().is("this")) {
                    self.check_ident(param, cx);
                }
            }
            _ => {}
        }
    }
}

impl Rule for IdLength {
    const META: Meta = Meta::eslint("id-length", Kind::Suggestion);
    const ON: On = On::new()
        .exprs(&[
            ExprTag::Ident,
            ExprTag::Dot,
            ExprTag::Assign,
            ExprTag::PrivateIdentifier,
        ])
        .stmts(&[
            StmtTag::Interface,
            StmtTag::TypeAlias,
            StmtTag::Enum,
            StmtTag::ImportEquals,
            StmtTag::ExportAsNamespace,
            StmtTag::ExportStar,
            StmtTag::Import,
            StmtTag::Module,
        ])
        .types(&[
            TypeTag::Import,
            TypeTag::Tuple,
            TypeTag::Ref,
            TypeTag::Typeof,
            TypeTag::Predicate,
        ])
        .pats(&[PatTag::Ident, PatTag::Object])
        .funcs()
        .classes()
        .members()
        .props()
        .type_params()
        .enum_members()
        .import_specs();
    /// Whether the length of each name that has been seen is wrong.
    type State<'a> = ByName<bool>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let patterns = options.strings("exceptionPatterns");
        let min = options.number("min").unwrap_or(2.0);
        let max = options.number("max").unwrap_or(f64::INFINITY);
        IdLength {
            min,
            max,
            properties: options.str("properties") != Some("never"),
            exceptions: (options.strings("exceptions").iter())
                .map(|it| it.as_bytes().into())
                .collect(),
            exception_patterns: patterns
                .iter()
                .filter_map(|it| Regex::new(it, "u").ok())
                .collect(),
            check_generic: options.bool_or("checkGeneric", true),
            enough: match max == f64::INFINITY {
                true => min.ceil() as usize,
                false => usize::MAX,
            },
        }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        if file.language().is_oxlint {
            let mut on = On::new()
                .pats(&[PatTag::Ident])
                .funcs()
                .classes()
                .import_specs()
                .stmts(&[
                    StmtTag::Interface,
                    StmtTag::TypeAlias,
                    StmtTag::Enum,
                    StmtTag::ImportEquals,
                    StmtTag::ExportAsNamespace,
                    StmtTag::ExportStar,
                    StmtTag::Import,
                    StmtTag::Module,
                ])
                .members()
                .enum_members()
                .types(&[
                    TypeTag::Import,
                    TypeTag::Tuple,
                    TypeTag::Ref,
                    TypeTag::Typeof,
                    TypeTag::Predicate,
                ]);
            if self.check_generic {
                on = on.type_params();
            }
            if self.properties {
                on = on.pats(&[PatTag::Object]).props().exprs(&[ExprTag::Assign]);
            }
            // The private names, wherever they are written.
            if strings::contains_char(file.text(), b'#') {
                on = on.exprs(&[ExprTag::Dot, ExprTag::PrivateIdentifier]);
            }
            return on;
        }
        let mut on = On::new()
            .pats(&[PatTag::Ident])
            .exprs(&[ExprTag::Ident])
            .members()
            .funcs()
            .classes()
            .stmts(&[StmtTag::Import])
            .import_specs();
        if self.properties {
            on = on
                .props()
                .types(&[TypeTag::Import])
                .exprs(&[ExprTag::Assign]);
        }
        on
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<ByName<bool>> {
        Some(ByName::default())
    }

    #[inline]
    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::Ident => self.check_reference(e, cx),
            ExprTag::Assign => {
                if let Some(target) = e.left() {
                    self.check_assigned(target, cx);
                }
            }
            ExprTag::Dot if e.is_private_member() => self.check_member_expression(e, cx),
            ExprTag::PrivateIdentifier => {
                if let ExprKind::PrivateIdentifier(name) = e.kind() {
                    self.check(cx, name, || Some(e.span()));
                }
            }
            _ => {}
        }
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if cx.language().is_oxlint {
            return self.check_statement_as_oxlint(statement, cx);
        }
        let Some(import) = statement.as_import() else {
            return;
        };
        for name in [import.default(), import.namespace()].into_iter().flatten() {
            self.check(cx, name.name(), || Some(name.span()));
        }
    }

    #[inline]
    fn ty<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        // As nearly all are that oxlint's rule is called with.
        if ty.as_ref().is_some_and(|(name, _)| name.len() == 1) {
            return;
        }
        match (ty.tag(), cx.language().is_oxlint) {
            (TypeTag::Import, false) => self.check_import_type(ty, cx),
            (
                TypeTag::Import
                | TypeTag::Tuple
                | TypeTag::Ref
                | TypeTag::Typeof
                | TypeTag::Predicate,
                true,
            ) => {
                self.check_type_as_oxlint(ty, cx);
            }
            _ => {}
        }
    }

    #[inline]
    fn pat<'a>(&self, pat: Pat<'a>, cx: &mut Cx<'a, Self>) {
        match (pat.tag(), cx.language().is_oxlint) {
            (PatTag::Ident, false) => self.check_binding(pat, cx),
            (PatTag::Ident, true) => self.check_binding_as_oxlint(pat, cx),
            (PatTag::Object, true) => self.check_keys_of_pattern(pat, cx),
            _ => {}
        }
    }

    #[inline]
    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if cx.language().is_oxlint {
            if let Some(name) = func.name() {
                self.check_ident(name, cx);
            }
            return;
        }
        if let Some(name) = func.name() {
            self.check(cx, name.name(), || func.has_body().then(|| name.span()));
        }
    }

    #[inline]
    fn class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        if cx.language().is_oxlint {
            if let Some(name) = class.name() {
                self.check_ident(name, cx);
            }
            return;
        }
        if let Some(name) = class.name() {
            self.check(cx, name.name(), || {
                matches!(class.owner(), Node::Stmt(_)).then(|| name.span())
            });
        }
    }

    #[inline]
    fn member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        if cx.language().is_oxlint {
            return self.check_member_as_oxlint(member, cx);
        }
        self.check_member(member, cx);
    }

    #[inline]
    fn prop<'a>(&self, prop: Prop<'a>, cx: &mut Cx<'a, Self>) {
        self.check_property(prop, cx);
        if let Some(value) = prop.value() {
            self.check_assigned(value, cx);
        }
    }

    #[inline]
    fn type_param<'a>(&self, it: TypeParam<'a>, cx: &mut Cx<'a, Self>) {
        self.check_ident(it.name(), cx);
    }

    #[inline]
    fn enum_member<'a>(&self, member: EnumMember<'a>, cx: &mut Cx<'a, Self>) {
        self.check_key(member.key(), cx);
    }

    #[inline]
    fn import_spec<'a>(&self, specifier: ImportSpec<'a>, cx: &mut Cx<'a, Self>) {
        if cx.language().is_oxlint {
            if specifier.imported().name() != specifier.local().name() {
                self.check_ident(specifier.local(), cx);
            }
            return;
        }
        let local = specifier.local();
        if specifier.imported().name() != local.name() {
            self.check(cx, local.name(), || Some(local.span()));
        }
    }
}
