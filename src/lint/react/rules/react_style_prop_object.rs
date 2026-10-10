use bun_lint_oxlint::ast_util::{get_declaration_of_variable, static_name};
use crate::jsx::{AttributeValue, get_prop_value};
use crate::react::{is_create_element_call, is_jsx};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

/// Require that the value of the prop `style` be an object or a variable that is an object.
pub struct StylePropObject {
    allow: Vec<Box<[u8]>>,
}

const STYLE_PROP_OBJECT: Message = Message::new("", "`style` prop value must be an object.");

#[derive(Default)]
pub struct State<'a> {
    /// Whether a variable is declared with something that is not an object.
    invalid_variables: FxHashMap<Symbol<'a>, bool>,
}

impl Rule for StylePropObject {
    const META: Meta = Meta::oxlint(Plugin::React, "style-prop-object", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Jsx, ExprTag::Call]);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        StylePropObject {
            allow: options.object(0).strings("allow").into_iter().map(|it| it.as_bytes().into()).collect(),
        }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let on = On::new().exprs(&[ExprTag::Jsx]);
        if !file.mentions("createElement") {
            return on;
        }
        on.exprs(&[ExprTag::Call])
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        if !is_jsx(file) || !file.mentions("style") {
            return None;
        }
        Some(State::default())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::Jsx => self.jsx(e, cx),
            ExprTag::Call => self.call(e, cx),
            _ => {}
        }
    }
}

impl StylePropObject {
    fn jsx<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        let styles = jsx.attrs().iter().filter(|it| it.key().is_some_and(|key| key.is("style")));
        for value in styles.filter_map(get_prop_value) {
            let is_invalid = match value {
                AttributeValue::StringLiteral(_) => true,
                _ => value.as_expression().is_some_and(|it| is_invalid_expression(it, &mut cx.state)),
            };
            // `<a.b>`, `<a:b>` and `<this>` are not looked at.
            if is_invalid
                && let Some(ExprKind::Ident(name) | ExprKind::String(name)) = jsx.tag().map(Expr::kind)
                && !strings::contains_char(name.bytes(), b':')
                && !self.allows(name)
            {
                cx.report(value.span(), STYLE_PROP_OBJECT);
            }
        }
    }

    fn call<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call().filter(|call| is_create_element_call(*call)) else {
            return;
        };
        let arguments = call.args();
        let Some(ExprKind::String(name) | ExprKind::Ident(name)) =
            arguments.first().filter(|it| !it.is_parenthesized()).map(Expr::kind)
        else {
            return;
        };
        let Some(ExprKind::Object(properties)) = arguments.get(1).filter(|it| !it.is_parenthesized()).map(Expr::kind)
        else {
            return;
        };
        if self.allows(name) {
            return;
        }
        for property in properties.iter().filter(|it| it.key().and_then(static_name).is_some_and(|key| key.is("style")))
        {
            if let Some(value) = property.value()
                && is_invalid_expression(value, &mut cx.state)
            {
                cx.report(value, STYLE_PROP_OBJECT);
            }
        }
    }

    fn allows(&self, name: Name) -> bool {
        self.allow.iter().any(|it| **it == *name.bytes())
    }
}

fn is_invalid_type(ty: TypeNode) -> bool {
    let is_invalid_keyword = |ty: TypeNode| {
        matches!(ty.kind(), TypeKind::Keyword(Keyword::Number | Keyword::String | Keyword::Boolean))
            && !ty.is_parenthesized()
    };
    // What is in parentheses is not looked into, so there is nothing but keywords in an intersection, and nothing but
    // these two in a union.
    let is_invalid_intersection = |ty: TypeNode| {
        matches!(ty.kind(), TypeKind::Intersection(types)
            if !ty.is_parenthesized() && types.iter().any(is_invalid_keyword))
    };
    is_invalid_keyword(ty)
        || is_invalid_intersection(ty)
        || matches!(ty.kind(), TypeKind::Union(types)
            if !ty.is_parenthesized() && types.iter().any(|it| is_invalid_keyword(it) || is_invalid_intersection(it)))
}

/// A string, a boolean, a template, or a variable that is declared with one of these or with a variable that is.
fn is_invalid_expression<'a>(expression: Expr<'a>, state: &mut State<'a>) -> bool {
    let mut passed: SmallVec<[Symbol<'a>; 4]> = SmallVec::new();
    let mut at = expression;
    let is_invalid = loop {
        if at.is_parenthesized() {
            break false;
        }
        match at.tag() {
            ExprTag::String | ExprTag::True | ExprTag::False | ExprTag::Template => break true,
            ExprTag::Ident => {}
            _ => break false,
        }
        let Some(symbol) = at.symbol() else {
            break false;
        };
        // Until it is known, a variable that is declared with itself is valid.
        if let Some(&known) = state.invalid_variables.get(&symbol) {
            break known;
        }
        state.invalid_variables.insert(symbol, false);
        passed.push(symbol);
        let Some(Node::VarDecl(declarator)) = get_declaration_of_variable(at).and_then(Declaration::node) else {
            break false;
        };
        if let Some(ty) = declarator.ty() {
            break is_invalid_type(ty);
        }
        match declarator.init() {
            Some(init) => at = init,
            None => break false,
        }
    };
    if is_invalid {
        state.invalid_variables.extend(passed.into_iter().map(|symbol| (symbol, true)));
    }
    is_invalid
}
