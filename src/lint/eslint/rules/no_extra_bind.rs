use bun_lint::prelude::*;
use bun_lint_oxlint::ast_util::get_inner_expression;

/// Disallow unnecessary calls to `.bind()`.
pub struct NoExtraBind;

const UNEXPECTED: Message = Message::new("unexpected", "The function binding is unnecessary.");

/// The keywords that would change meaning if a function became an arrow function.
#[derive(Default)]
pub(crate) struct OwnKeywords {
    pub(crate) this: bool,
    pub(crate) has_super: bool,
    pub(crate) new_target: bool,
}

impl OwnKeywords {
    /// Records `e` if it's one of them. Returns whether it is.
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

/// True for a class field, whose type and initializer are in a `PropertyDefinition` in ESLint.
fn is_property_definition(member: Member) -> bool {
    member.kind() == MemberKind::Property
        && !member.is_signature()
        && !member.flags().intersects(Flags::ACCESSOR | Flags::ABSTRACT)
}

/// Finds the `this`, `super` and `new.target` in `func`, skipping nested functions that aren't arrow functions. With
/// `class_scopes`, also skips field initializers and static blocks of nested classes.
pub(crate) fn own_keywords(func: Func, class_scopes: bool) -> OwnKeywords {
    let mut found = OwnKeywords::default();
    let mut pending = Node::Func(func).children();
    while let Some(node) = pending.pop() {
        match node {
            // In ESLint the `this` of `<this.a />` is a name.
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

/// oxlint's `function_body_contains_this`: it only looks in the body. It counts a JSX element name and the fields and
/// static blocks of classes, but not types.
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
    const META: Meta = Meta::eslint("no-extra-bind", Kind::Suggestion).fixable(Fixable::Code).reports_on_exit();
    const ON: On = On::new().method_calls(&["bind"]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoExtraBind
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions("bind").then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call() else {
            return;
        };
        let member = call.callee();
        let Some(function) = member.object() else {
            return;
        };
        // oxlint looks through `as T` and the like.
        let is_oxlint = cx.language().is_oxlint;
        let Some(func) = (if is_oxlint { get_inner_expression(function) } else { function }).as_fn() else {
            return;
        };
        let property = match (member.member_name(), member.index()) {
            (Some(name), _) => name.span(),
            (None, Some(index)) => index.span(),
            (None, None) => return,
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
