use bun_lint::prelude::*;
use std::borrow::Cow;

/// Require function names to match the name of the variable or property to which they are assigned.
pub struct FuncNameMatching {
    is_never: bool,
    consider_property_descriptor: bool,
    include_module_exports: bool,
}

const MATCH_PROPERTY: Message = Message::new(
    "matchProperty",
    "Function name `{{funcName}}` should match property name `{{name}}`.",
);
const MATCH_VARIABLE: Message = Message::new(
    "matchVariable",
    "Function name `{{funcName}}` should match variable name `{{name}}`.",
);
const NOT_MATCH_PROPERTY: Message = Message::new(
    "notMatchProperty",
    "Function name `{{funcName}}` should not match property name `{{name}}`.",
);
const NOT_MATCH_VARIABLE: Message = Message::new(
    "notMatchVariable",
    "Function name `{{funcName}}` should not match variable name `{{name}}`.",
);

/// ESLint's `isModuleExports`: `module.exports` or `module["exports"]`.
fn is_module_exports(pattern: Expr<'_>) -> bool {
    match pattern.kind() {
        ExprKind::Dot { obj, name, .. } => obj.is_ident("module") && name.name().is("exports"),
        ExprKind::Index { obj, index, .. } => {
            obj.is_ident("module") && index.as_string().is_some_and(|it| it.is("exports"))
        }
        _ => false,
    }
}

/// ESLint's `isPropertyCall`: `node` is a call of `object_name.function_name`.
fn is_property_call(node: Node<'_>, object_name: &str, function_name: &str) -> bool {
    node.as_expr().and_then(Expr::as_call).is_some_and(|call| {
        ast_utils::is_specific_member_access(call.callee(), Some(object_name), Some(function_name))
    })
}

/// The value of a key that is a string literal, in brackets or not.
fn string_literal_key<'a>(key: Key<'a>, file: &'a File<'a>) -> Option<Name<'a>> {
    match key.kind() {
        KeyKind::String(value) => Some(value),
        KeyKind::ComputedString(value) => {
            let is_template = file.slice(key.inner_span(file)).starts_with(b"`");
            (!is_template).then_some(value)
        }
        KeyKind::Computed(e) => e.as_string(),
        _ => None,
    }
}

impl FuncNameMatching {
    /// ESLint's `shouldWarn`.
    #[inline]
    fn should_warn(&self, x: &[u8], y: &[u8]) -> bool {
        (x == y) == self.is_never
    }

    fn report<'a>(
        &self,
        cx: &Cx<'a, Self>,
        node: impl Spanned,
        name: impl IntoText<'a>,
        func_name: Ident<'a>,
        is_prop: bool,
    ) {
        let message = match (self.is_never, is_prop) {
            (false, true) => MATCH_PROPERTY,
            (false, false) => MATCH_VARIABLE,
            (true, true) => NOT_MATCH_PROPERTY,
            (true, false) => NOT_MATCH_VARIABLE,
        };
        cx.report(node, message).data("name", name).data("funcName", func_name);
    }

    fn check<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if func.kind() != FnKind::Expr {
            return;
        }
        let (Some(func_name), Node::Expr(function)) = (func.name(), func.owner()) else {
            return;
        };
        match function.parent() {
            Node::VarDecl(declarator) => {
                if let Some(name) = declarator.pat().as_ident()
                    && self.should_warn(name.bytes(), func_name.bytes())
                {
                    self.report(cx, declarator, name, func_name, false);
                }
            }
            Node::Expr(assignment) => self.check_assignment(assignment, function, func_name, cx),
            Node::Prop(prop) => {
                if prop.value() == Some(function)
                    && !prop.is_jsx_attribute()
                    && let Some(key) = prop.key()
                {
                    self.check_property(Node::Prop(prop), key, func_name, cx);
                }
            }
            Node::Member(member) => {
                if member.init() == Some(function)
                    && !member.flags().contains(Flags::ACCESSOR)
                    && let Some(key) = member.key()
                {
                    self.check_property(Node::Member(member), key, func_name, cx);
                }
            }
            _ => {}
        }
    }

    fn check_assignment<'a>(
        &self,
        assignment: Expr<'a>,
        function: Expr<'a>,
        func_name: Ident<'a>,
        cx: &Cx<'a, Self>,
    ) {
        let ExprKind::Assign { target, value, .. } = assignment.kind() else {
            return;
        };
        if value != function || utils::is_assignment_target(assignment) {
            return;
        }
        let is_prop = match target.kind() {
            ExprKind::Ident(_) => false,
            ExprKind::Dot { .. } => true,
            ExprKind::Index { index, .. } if ast_utils::is_literal(index) => true,
            _ => return,
        };
        if !self.include_module_exports && is_module_exports(target) {
            return;
        }
        let name = match target.as_ident() {
            Some(name) => Some(Cow::Borrowed(name.bytes())),
            None => ast_utils::get_static_property_name(target),
        };
        // Upstream does not pass the ECMAScript version here.
        if let Some(name) = name
            && text::is_identifier_es5(&name)
            && self.should_warn(&name, func_name.bytes())
        {
            self.report(cx, assignment, name, func_name, is_prop);
        }
    }

    /// `node` is a `Prop` or a `Member` whose value is the function.
    fn check_property<'a>(&self, node: Node<'a>, key: Key<'a>, func_name: Ident<'a>, cx: &Cx<'a, Self>) {
        let KeyKind::Ident(property_name) = key.kind() else {
            let is_identifier: fn(&[u8]) -> bool = match cx.language().ecma_version >= 2015 {
                true => text::is_identifier_es6,
                false => text::is_identifier_es5,
            };
            if let Some(value) = string_literal_key(key, cx.file())
                && is_identifier(value.bytes())
                && self.should_warn(value.bytes(), func_name.bytes())
            {
                self.report(cx, node, value, func_name, true);
            }
            return;
        };
        if self.consider_property_descriptor
            && property_name.is("value")
            && let Node::Prop(prop) = node
            && let Node::Expr(descriptor) = prop.parent()
        {
            let owner = descriptor.parent();
            if is_property_call(owner, "Object", "defineProperty")
                || is_property_call(owner, "Reflect", "defineProperty")
            {
                let property = owner.as_expr().and_then(Expr::as_call).and_then(|call| call.args().get(1));
                if let Some(value) = property.and_then(Expr::as_string)
                    && self.should_warn(value.bytes(), func_name.bytes())
                {
                    self.report(cx, node, value, func_name, true);
                }
                return;
            }
            if let Node::Prop(outer) = owner
                && !outer.is_jsx_attribute()
                && let Node::Expr(descriptors) = outer.parent()
                && (is_property_call(descriptors.parent(), "Object", "defineProperties")
                    || is_property_call(descriptors.parent(), "Object", "create"))
            {
                // `key.name`, which is `undefined` for a key that is not an identifier.
                match outer.key().map(Key::kind) {
                    Some(KeyKind::Ident(name)) => {
                        if self.should_warn(name.bytes(), func_name.bytes()) {
                            self.report(cx, node, name, func_name, true);
                        }
                    }
                    Some(KeyKind::String(_) | KeyKind::Number(_)) if !self.is_never => {
                        self.report(cx, node, "undefined", func_name, true);
                    }
                    _ => {}
                }
                return;
            }
        }
        if self.should_warn(property_name.bytes(), func_name.bytes()) {
            self.report(cx, node, property_name, func_name, true);
        }
    }
}

impl Rule for FuncNameMatching {
    const META: Meta = Meta::eslint("func-name-matching", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let object = options.first_object();
        FuncNameMatching {
            is_never: options.str(0) == Some("never"),
            consider_property_descriptor: object.bool_or("considerPropertyDescriptor", false),
            include_module_exports: object.bool_or("includeCommonJSModuleExports", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.funcs(Self::check);
    }
}
