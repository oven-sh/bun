use bun_core::strings;
use bun_lint::prelude::*;
use rustc_hash::FxHashSet;

/// Enforce camelcase naming convention.
pub struct Camelcase {
    /// Each entry as it is, and as a regular expression.
    allow: Vec<(Box<[u8]>, Option<Regex>)>,
    ignores_destructuring: bool,
    ignores_globals: bool,
    ignores_imports: bool,
    checks_properties: bool,
}

const NOT_CAMEL_CASE: Message =
    Message::new("notCamelCase", "Identifier '{{name}}' is not in camel case.");
const NOT_CAMEL_CASE_PRIVATE: Message =
    Message::new("notCamelCasePrivate", "#{{name}} is not in camel case.");

#[derive(Default)]
pub struct State {
    /// Where the reported identifiers start. The key and the value of a shorthand property are
    /// reported once.
    reported: FxHashSet<u32>,
    /// Some name that is declared in a scope or refers to something is not good, so that it is
    /// worth looking at the variables.
    has_bad_variable_name: bool,
}

/// It contains an underscore, other than at its ends, and is not all upper case.
fn is_underscored(name: &[u8]) -> bool {
    if !strings::contains_char(name, b'_') {
        return false;
    }
    let mut body = name;
    while let [b'_', rest @ ..] = body {
        body = rest;
    }
    while let [rest @ .., b'_'] = body {
        body = rest;
    }
    strings::contains_char(body, b'_')
        && (body.iter().any(u8::is_ascii_lowercase) || !text::is_upper_case(body))
}

/// `key` is the identifier `name`, not in brackets.
fn is_identifier_key<'a>(key: Option<Key<'a>>, name: Name<'a>) -> bool {
    matches!(key.map(Key::kind), Some(KeyKind::Ident(it)) if it == name)
}

/// ESLint has an `AssignmentPattern` for it: `a = 1` in the target of a destructuring assignment.
fn is_assignment_pattern(e: Expr<'_>) -> bool {
    matches!(e.kind(), ExprKind::Assign { op: None, .. }) && utils::is_assignment_target(e)
}

/// `equalsToOriginalName` for an identifier that is an expression: it is the value of a property
/// of the same name, in an object literal or in the target of a destructuring assignment.
fn reference_equals_to_original_name(e: Expr<'_>) -> bool {
    let Some(local) = e.as_ident() else {
        return false;
    };
    let value = match e.parent() {
        Node::Expr(parent) if is_assignment_pattern(parent) => parent,
        _ => e,
    };
    matches!(
        value.parent(),
        Node::Prop(prop) if prop.value() == Some(value)
            && !prop.is_jsx_attribute()
            && is_identifier_key(prop.key(), local)
    )
}

/// `equalsToOriginalName` for an identifier that a pattern binds.
fn binding_equals_to_original_name(pat: Pat<'_>) -> bool {
    matches!(
        (pat.parent(), pat.as_ident()),
        (Node::PatProp(prop), Some(local)) if is_identifier_key(prop.key(), local)
    )
}

fn report<'a>(cx: &mut Cx<'a, Camelcase>, at: Span, name: &'a [u8], message: Message) {
    if cx.state.reported.insert(at.start) {
        cx.report(at, message).data("name", name);
    }
}

impl Camelcase {
    fn is_good_name(&self, name: &[u8]) -> bool {
        !is_underscored(name)
            || (self.allow.iter())
                .any(|(entry, regex)| **entry == *name || regex.as_ref().is_some_and(|it| it.test(name)))
    }

    /// Reports a name that is neither declared in a scope nor a reference.
    fn check_name<'a>(&self, name: Ident<'a>, cx: &mut Cx<'a, Self>) {
        if !self.is_good_name(name.bytes()) {
            report(cx, name.span(), name.bytes(), NOT_CAMEL_CASE);
        }
    }

    /// Takes note of a name that is declared in a scope or is a reference.
    fn note_variable_name<'a>(&self, name: Name<'a>, cx: &mut Cx<'a, Self>) {
        if !cx.state.has_bad_variable_name && !self.is_good_name(name.bytes()) {
            cx.state.has_bad_variable_name = true;
        }
    }

    /// The `b` of an `a.b` that is assigned to.
    fn check_member_access<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Dot { name, .. } = e.kind() else {
            return;
        };
        // The head of a `for`-`in` or a `for`-`of` does not count.
        if self.is_good_name(name.bytes())
            || name.bytes().starts_with(b"#")
            || matches!(e.parent(), Node::Stmt(_))
            || !utils::is_assignment_target(e)
        {
            return;
        }
        report(cx, name.span(), name.bytes(), NOT_CAMEL_CASE);
    }

    /// ESLint's `reportReferenceId`.
    fn report_reference<'a>(&self, reference: Reference<'a>, cx: &mut Cx<'a, Self>) {
        match reference.node() {
            Node::Expr(e) => {
                match e.parent() {
                    Node::Expr(parent) => match parent.kind() {
                        ExprKind::Call(_) | ExprKind::New(_) => return,
                        ExprKind::Assign { value, .. } if value == e && is_assignment_pattern(parent) => return,
                        _ => {}
                    },
                    Node::Param(it) if it.default() == Some(e) => return,
                    Node::PatProp(it) if it.default() == Some(e) => return,
                    Node::PatElem(it) if it.default() == Some(e) => return,
                    Node::Prop(prop)
                        if prop.kind() == PropKind::Shorthand && ast_utils::is_import_attribute_key(prop) =>
                    {
                        return;
                    }
                    _ => {}
                }
                if self.ignores_destructuring && reference_equals_to_original_name(e) {
                    return;
                }
            }
            Node::Pat(pat) => {
                if !(self.ignores_destructuring && binding_equals_to_original_name(pat)) {
                    report(cx, utils::estree_span(pat.into()), reference.name().bytes(), NOT_CAMEL_CASE);
                }
                return;
            }
            _ => {}
        }
        report(cx, reference.span(), reference.name().bytes(), NOT_CAMEL_CASE);
    }

    /// What is declared by a variable declaration, a function, a class, a `catch` clause or an
    /// import, with the references to it.
    fn check_symbol<'a>(&self, symbol: Symbol<'a>, cx: &mut Cx<'a, Self>) {
        let (mut is_declared, mut is_imported) = (false, false);
        for declaration in symbol.declarations() {
            match declaration {
                Declaration::Var(_) | Declaration::Class(_) => is_declared = true,
                // A function without a body is a node of another type.
                Declaration::Fn(func) => is_declared |= func.has_body(),
                Declaration::Param(pat) => {
                    is_declared |= Node::Pat(pat).enclosing_function().is_some_and(Func::has_body);
                }
                Declaration::ImportDefault(_)
                | Declaration::ImportNamespace(_)
                | Declaration::ImportSpec(_) => is_imported = true,
                _ => {}
            }
        }
        let Some(first) = symbol.declarations().next().filter(|_| is_declared || is_imported) else {
            return;
        };
        let equals_to_original_name = match first {
            Declaration::Var(pat) | Declaration::Param(pat) => binding_equals_to_original_name(pat),
            Declaration::ImportSpec(spec) => spec.imported().name() == spec.local().name(),
            _ => false,
        };
        let id = match first {
            Declaration::Var(pat) | Declaration::Param(pat) => Some(utils::estree_span(pat.into())),
            _ => first.name_span(),
        };
        if ((is_declared && !(self.ignores_destructuring && equals_to_original_name))
            || (is_imported && !(self.ignores_imports && equals_to_original_name)))
            && let Some(id) = id
        {
            report(cx, id, symbol.name().bytes(), NOT_CAMEL_CASE);
        }
        // For ESLint a class also declares its name in a scope of its own, where it comes first.
        for declaration in symbol.declarations() {
            if let Declaration::Class(class) = declaration
                && let Some(name) = class.name()
            {
                report(cx, name.span(), name.bytes(), NOT_CAMEL_CASE);
            }
        }
        for reference in symbol.references() {
            if is_imported || !reference.is_init() {
                self.report_reference(reference, cx);
            }
        }
    }
}

impl Rule for Camelcase {
    const META: Meta = Meta::eslint("camelcase", Kind::Suggestion);
    const ON: On = On::new()
        .exprs(&[ExprTag::Dot, ExprTag::Ident, ExprTag::Jsx])
        .stmts(&[
            StmtTag::Labeled,
            StmtTag::Break,
            StmtTag::Continue,
            StmtTag::ExportStar,
            StmtTag::Import,
            StmtTag::ImportEquals,
            StmtTag::ExportAsNamespace,
        ])
        .types(&[TypeTag::Ref, TypeTag::Predicate, TypeTag::Import])
        .pats(&[PatTag::Ident])
        .funcs()
        .classes()
        .members()
        .props()
        .import_specs()
        .export_specs()
        .finish();
    type State<'a> = State;

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        Camelcase {
            allow: (object.strings("allow").into_iter())
                .map(|entry| (entry.as_bytes().into(), Regex::new(entry, "u").ok()))
                .collect(),
            ignores_destructuring: object.bool_or("ignoreDestructuring", false),
            ignores_globals: object.bool_or("ignoreGlobals", false),
            ignores_imports: object.bool_or("ignoreImports", false),
            checks_properties: object.str("properties") != Some("never"),
        }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<State> {
        Some(State::default())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::Dot if self.checks_properties => self.check_member_access(e, cx),
            ExprTag::Ident => {
                if let Some(name) = e.as_ident() {
                    self.note_variable_name(name, cx);
                }
            }
            // The tags `a-b` and `a:b` are references too.
            ExprTag::Jsx => {
                if let ExprKind::Jsx(jsx) = e.kind()
                    && let Some(tag) = jsx.tag()
                    && matches!(tag.kind(), ExprKind::String(_))
                    && strings::contains_char(tag.text(), b'_')
                {
                    cx.state.has_bad_variable_name = true;
                }
            }
            _ => {}
        }
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        match stmt.kind() {
            StmtKind::Labeled { .. } | StmtKind::Break(_) | StmtKind::Continue(_) => {
                if let Some(label) = stmt.label() {
                    self.check_name(label, cx);
                }
            }
            StmtKind::ExportStar {
                alias: Some(alias), ..
            } if !alias.is_string() => self.check_name(alias, cx),
            StmtKind::Import(import) => {
                for local in import.default().into_iter().chain(import.namespace()) {
                    self.note_variable_name(local.name(), cx);
                }
            }
            StmtKind::ImportEquals(import) => {
                if let ImportEqualsTarget::Entity(entity) = import.target()
                    && let Some(first) = entity.first()
                {
                    self.note_variable_name(first.name(), cx);
                }
            }
            StmtKind::ExportAsNamespace(name) => self.note_variable_name(name, cx),
            _ => {}
        }
    }

    /// The names in a type that are references, and the keys in `import("m", { with: { key: "" } })`,
    /// which ESLint has as an object literal.
    fn ty<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        if cx.file().is_javascript() {
            return;
        }
        match ty.kind() {
            TypeKind::Ref { name, .. } => {
                if let Some(first) = name.first() {
                    self.note_variable_name(first.name(), cx);
                }
            }
            TypeKind::Predicate { param, .. } => self.note_variable_name(param, cx),
            TypeKind::Import { .. } if self.checks_properties => {
                for entry in ty.import_attributes().into_iter().flat_map(ImportAttributes::entries) {
                    if let Some(key) = entry.key()
                        && let KeyKind::Ident(name) = key.kind()
                        && !self.is_good_name(name.bytes())
                    {
                        let at = key.span(cx.file());
                        report(cx, at, name.bytes(), NOT_CAMEL_CASE);
                    }
                }
            }
            _ => {}
        }
    }

    fn pat<'a>(&self, pat: Pat<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(name) = pat.as_ident() {
            self.note_variable_name(name, cx);
        }
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(name) = func.name() {
            self.note_variable_name(name.name(), cx);
        }
    }

    fn class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(name) = class.name() {
            self.note_variable_name(name.name(), cx);
        }
    }

    /// The key of a method or a field of a class.
    fn member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        if !self.checks_properties {
            return;
        }
        let Some(key) = member.key() else {
            return;
        };
        let (name, message) = match key.kind() {
            KeyKind::Ident(name) => (name.bytes(), NOT_CAMEL_CASE),
            KeyKind::Private(name) => {
                let name = name.bytes();
                (name.strip_prefix(b"#").unwrap_or(name), NOT_CAMEL_CASE_PRIVATE)
            }
            _ => return,
        };
        // An abstract member and an `accessor` field are nodes of other types.
        if self.is_good_name(name)
            || member.is_signature()
            || member.flags().intersects(Flags::ABSTRACT | Flags::ACCESSOR)
        {
            return;
        }
        let at = key.span(cx.file());
        report(cx, at, name, message);
    }

    /// The key of a property of an object literal.
    fn prop<'a>(&self, prop: Prop<'a>, cx: &mut Cx<'a, Self>) {
        if !self.checks_properties {
            return;
        }
        let Some(key) = prop.key() else {
            return;
        };
        let KeyKind::Ident(name) = key.kind() else {
            return;
        };
        if self.is_good_name(name.bytes())
            || prop.is_jsx_attribute()
            || ast_utils::is_import_attribute_key(prop)
            || !matches!(prop.parent(), Node::Expr(object) if !utils::is_assignment_target(object))
        {
            return;
        }
        let at = key.span(cx.file());
        report(cx, at, name.bytes(), NOT_CAMEL_CASE);
    }

    fn import_spec<'a>(&self, spec: ImportSpec<'a>, cx: &mut Cx<'a, Self>) {
        self.note_variable_name(spec.local().name(), cx);
    }

    fn export_spec<'a>(&self, spec: ExportSpec<'a>, cx: &mut Cx<'a, Self>) {
        if !spec.exported().is_string() {
            self.check_name(spec.exported(), cx);
        }
        if !spec.export().has_from() {
            self.note_variable_name(spec.local().name(), cx);
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        if !cx.state.has_bad_variable_name {
            return;
        }
        let file = cx.file();
        for symbol in file.symbols() {
            if !self.is_good_name(symbol.name().bytes()) {
                self.check_symbol(symbol, cx);
            }
        }
        for reference in file.unresolved_references() {
            let name = reference.name().bytes();
            if !self.is_good_name(name)
                && !(self.ignores_globals && ast_utils::is_configured_global(file, name))
            {
                self.report_reference(reference, cx);
            }
        }
    }
}
