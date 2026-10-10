use bun_lint::prelude::*;
use bun_lint_oxlint::ast_util::get_inner_expression;

/// Disallow unnecessary calls to `.bind()`.
pub struct NoExtraBind;

const UNEXPECTED: Message = Message::new("unexpected", "The function binding is unnecessary.");

/// What a function would mean differently if it were an arrow function.
#[derive(Default)]
pub(crate) struct OwnKeywords {
    pub(crate) this: bool,
    pub(crate) has_super: bool,
    pub(crate) new_target: bool,
}

impl OwnKeywords {
    /// Whether `e` is one of them, which is then kept.
    pub(crate) fn note(&mut self, e: Expr) -> bool {
        match e.tag() {
            ExprTag::This => self.this = true,
            ExprTag::Super => self.has_super = true,
            ExprTag::NewTarget => self.new_target = true,
            _ => return false,
        }
        true
    }
}

/// A field of a class, whose type and initializer ESLint has in a `PropertyDefinition`.
fn is_property_definition(member: Member) -> bool {
    member.kind() == MemberKind::Property
        && !member.is_signature()
        && !member.flags().intersects(Flags::ACCESSOR | Flags::ABSTRACT)
}

/// The `this`, `super` and `new.target` in `func`, not those in the functions in it that are not
/// arrow functions. `class_scopes`: nor those in the initializers of fields and in the static blocks
/// of classes.
pub(crate) fn own_keywords(func: Func, class_scopes: bool) -> OwnKeywords {
    let mut found = OwnKeywords::default();
    let mut pending = Node::Func(func).children();
    while let Some(node) = pending.pop() {
        match node {
            // For ESLint the `this` of `<this.a />` is a name.
            Node::Expr(e) if e.tag() == ExprTag::This && e.is_jsx_tag_name() => {}
            Node::Expr(e) if found.note(e) => {}
            Node::Func(inner) if inner.kind() == FnKind::StaticBlock && !class_scopes => {
                node.for_each_child(|child| pending.push(child));
            }
            Node::Func(inner) if !inner.is_arrow() && inner.has_body() => {}
            // The decorators and the key are evaluated outside.
            Node::Member(member) if class_scopes && is_property_definition(member) => {
                pending.extend(member.decorators().map(Node::Expr));
                if let Some(KeyKind::Computed(key)) = member.key().map(Key::kind) {
                    pending.push(Node::Expr(key));
                }
            }
            _ => node.for_each_child(|child| pending.push(child)),
        }
    }
    found
}

/// oxlint's `function_body_contains_this`: in the body alone, also as the name of a JSX element and in the fields and
/// the static blocks of classes, but not in a type.
fn body_contains_this_for_oxlint(func: Func) -> bool {
    let mut pending: Vec<Node> = func.body_statements().into_iter().flatten().map(Node::Stmt).collect();
    while let Some(node) = pending.pop() {
        match node {
            Node::Expr(e) if e.tag() == ExprTag::This => return true,
            Node::Type(_) => {}
            Node::Func(inner) if !inner.is_arrow() && inner.kind() != FnKind::StaticBlock => {}
            _ => node.for_each_child(|child| pending.push(child)),
        }
    }
    false
}

/// ESLint's `isSideEffectFree`.
fn is_side_effect_free(e: Expr) -> bool {
    match e.kind() {
        ExprKind::String(_)
        | ExprKind::Number(_)
        | ExprKind::BigInt(_)
        | ExprKind::Regex(_)
        | ExprKind::True
        | ExprKind::False
        | ExprKind::Null
        | ExprKind::Ident(_)
        | ExprKind::This => true,
        ExprKind::Fn(func) => !func.is_arrow(),
        _ => false,
    }
}

/// Removes `.bind` and `(argument)`. There can be closing parentheses between the two.
fn fix<'a>(fixer: Fixer<'a>, call: Expr<'a>, member: Expr<'a>, function: Expr<'a>) -> Option<[Fix; 2]> {
    let file = fixer.file();
    let first = file.tokens_after(function).find(ast_utils::is_not_closing_paren_token)?;
    let arguments = file.tokens_after(member).find(ast_utils::is_not_closing_paren_token)?;
    if file.comments_exist_between(first, file.last_token(call)?) {
        return None;
    }
    Some([
        fixer.remove(Span::new(first.start(), member.span().end)),
        fixer.remove(Span::new(arguments.start(), call.span().end)),
    ])
}

impl Rule for NoExtraBind {
    const META: Meta = Meta::eslint("no-extra-bind", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoExtraBind
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions("bind").then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Call(call) = e.kind() else {
            return;
        };
        let member = call.callee();
        let (function, property) = match member.kind() {
            ExprKind::Dot { obj, name, .. } => (obj, name.span()),
            ExprKind::Index { obj, index, .. } => (obj, index.span()),
            _ => return,
        };
        // oxlint sees through `as T` and the like.
        let is_oxlint = cx.language().is_oxlint;
        let ExprKind::Fn(func) = (if is_oxlint { get_inner_expression(function) } else { function }).kind() else {
            return;
        };
        let (Some(argument), 1) = (call.args().first(), call.args().len()) else {
            return;
        };
        let uses_this = || match is_oxlint {
            true => body_contains_this_for_oxlint(func),
            false => own_keywords(func, true).this,
        };
        if argument.tag() == ExprTag::Spread
            || !ast_utils::is_specific_member_access(member, None, Some("bind"))
            || !func.is_arrow() && uses_this()
        {
            return;
        }
        cx.report(property, UNEXPECTED).fix(|fixer| {
            let is_fixable = is_side_effect_free(argument) && function.tag() == ExprTag::Fn;
            is_fixable.then(|| fix(fixer, e, member, function)).flatten()
        });
    }
}
