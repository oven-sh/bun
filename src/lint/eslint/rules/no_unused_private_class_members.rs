use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use rustc_hash::FxHashMap;

/// Disallow unused private class members.
pub struct NoUnusedPrivateClassMembers;

const UNUSED_PRIVATE_CLASS_MEMBER: Message =
    Message::new("unusedPrivateClassMember", "'{{classMemberName}}' is defined but never used.");
const REMOVE_UNUSED_PRIVATE_CLASS_MEMBER: Message = Message::new(
    "removeUnusedPrivateClassMember",
    "Remove unused private class member '{{classMemberName}}'.",
);

struct PrivateMember<'a> {
    /// The last member of that name: the second of a getter and a setter.
    declared: Member<'a>,
    is_accessor: bool,
    has_reference: bool,
    is_used: bool,
}

#[derive(Default)]
pub struct State<'a> {
    /// By class and by name, which includes the `#`.
    members: FxHashMap<(Class<'a>, Name<'a>), PrivateMember<'a>>,
    /// Every private name that is not the key of a field or a method, and where it is: an `a.#x`,
    /// the `#x` of `#x in a`, an `accessor #x`.
    usages: Vec<(Node<'a>, Name<'a>)>,
    /// For oxlint: every private field and method, with its class and its name.
    declared: Vec<(Class<'a>, Name<'a>, Member<'a>)>,
}

/// The class whose body `child` is directly in. The heritage and the decorators of a class are not in its body.
fn class_of_member<'a>(child: Node<'a>, parent: Node<'a>) -> Option<Class<'a>> {
    match (parent, child) {
        (Node::Class(class), Node::Member(_)) => Some(class),
        _ => None,
    }
}

/// oxlint's `is_value_context`: whether the value of `e` goes somewhere, by what `e` is directly in. What only passes the value
/// on is asked in its turn: `a ? e : b`, `a && e`, `e++`, `e as T`.
fn is_value_context(e: Expr<'_>) -> bool {
    let mut child = e;
    loop {
        // oxc has a `ChainExpression` around it.
        if child.is_chain_root() {
            return true;
        }
        let parent = match child.parent() {
            Node::Expr(parent) => parent,
            Node::Stmt(statement) => {
                return matches!(
                    statement.tag(),
                    StmtTag::Return | StmtTag::If | StmtTag::Switch | StmtTag::Throw | StmtTag::While | StmtTag::DoWhile
                );
            }
            Node::Case(_) | Node::VarDecl(_) => return true,
            Node::Prop(prop) => {
                return match prop.parent() {
                    // `a={e}`, not `{...e}`.
                    Node::Expr(owner) if owner.tag() == ExprTag::Jsx => {
                        prop.kind() != PropKind::Spread && child.jsx_container_span().is_some()
                    }
                    Node::Expr(owner) => !owner.is_assignment_target(),
                    _ => false,
                };
            }
            // The key and the value of a field.
            Node::Member(member) => {
                return member.kind() == MemberKind::Property
                    && !member.flags().contains(Flags::ACCESSOR)
                    && !member.decorators().any(|it| it == child);
            }
            Node::Param(param) => return param.default() == Some(child),
            Node::PatProp(property) => return property.default() == Some(child),
            Node::PatElem(element) => return element.default() == Some(child),
            Node::Func(func) => return func.is_arrow(),
            _ => return false,
        };
        match parent.kind() {
            ExprKind::Call(_)
            | ExprKind::New(_)
            | ExprKind::Index { .. }
            | ExprKind::Template(_)
            | ExprKind::Await(_) => return true,
            ExprKind::TaggedTemplate(call) => return call.callee() != child,
            ExprKind::Dot { .. } => return !parent.is_private_member(),
            ExprKind::Array(_) => return !parent.is_assignment_target(),
            ExprKind::Spread(_) => return !parent.is_assignment_target() && parent.jsx_container_span().is_none(),
            ExprKind::Jsx(_) => return child.jsx_container_span().is_some(),
            ExprKind::Assign { value, .. } => return value == child && !parent.is_assignment_target(),
            ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish, .. }
            | ExprKind::Unary { op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec, .. }
            | ExprKind::Cond { .. }
            | ExprKind::As { .. }
            | ExprKind::AsConst(_)
            | ExprKind::Satisfies { .. }
            | ExprKind::NonNull(_)
            | ExprKind::Instantiation { .. } => {}
            // `#x in e`
            ExprKind::Binary { op: BinOp::In, left, .. } if left.tag() == ExprTag::PrivateIdentifier => return false,
            ExprKind::Binary { .. } | ExprKind::Unary { .. } => return true,
            _ => return false,
        }
        child = parent;
    }
}

/// oxlint's `is_read`, of an `a.#x`.
fn is_read_for_oxlint(access: Expr<'_>) -> bool {
    let is_cast = |e: Expr| {
        matches!(e.tag(), ExprTag::As | ExprTag::AsConst | ExprTag::Satisfies | ExprTag::NonNull | ExprTag::Instantiation)
    };
    let mut top = access;
    while !top.is_chain_root()
        && let Node::Expr(parent) = top.parent()
        && is_cast(parent)
    {
        top = parent;
    }
    if is_value_context(top) {
        return true;
    }
    // Some places count only for what is written there with nothing around it.
    let is_bare = top == access && !access.is_parenthesized();
    match top.parent() {
        Node::Expr(parent) => match parent.kind() {
            // `a = this.#x += 1`
            ExprKind::Assign { op: Some(_), target, .. } => {
                target == top && !parent.is_assignment_target() && is_value_context(parent)
            }
            ExprKind::Cond { test, .. } => is_bare && test == top,
            ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish, left, .. } => left == top,
            _ => false,
        },
        Node::Stmt(statement) => match statement.kind() {
            StmtKind::ForIn { expr, .. } | StmtKind::ForOf { expr, .. } => is_bare && expr == top,
            _ => false,
        },
        // `({ [this.#x]: a } = b)`
        Node::Prop(prop) => {
            is_bare
                && matches!(prop.key().map(Key::kind), Some(KeyKind::Computed(key)) if key == top)
                && matches!(prop.parent(), Node::Expr(object) if object.is_assignment_target())
        }
        _ => false,
    }
}

fn is_in_expression_statement(e: Expr<'_>) -> bool {
    matches!(e.parent(), Node::Stmt(statement) if utils::is_expression_statement(statement))
}

/// Whether the value of `access`, an `a.#x`, is not read, or is read only to be written back by a
/// statement that does nothing else.
fn is_write_only(access: Expr<'_>) -> bool {
    if let Node::Expr(parent) = access.parent() {
        match parent.kind() {
            ExprKind::Assign { op: Some(_), target, .. } if target == access => {
                return is_in_expression_statement(parent);
            }
            ExprKind::Unary {
                op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                ..
            } => return is_in_expression_statement(parent),
            _ => {}
        }
    }
    utils::is_assignment_target(access)
}

/// ESLint's `getMemberRemovalRange`.
fn get_member_removal_range<'a>(file: &'a File<'a>, member: Member<'a>) -> Option<Span> {
    let node = member.span();
    let line_start_index = |offset: u32| file.line_span(file.line_of(offset)).start;
    let starts_on_own_line = |at: Span| {
        let before = file.tokens_before(at).with_comments().next();
        before.is_some_and(|before| file.line_of(before.end()) != file.line_of(at.start))
    };
    let previous_token = file.token_before(node)?;
    let shares_line_with_another_token = file.line_of(previous_token.end()) == file.line_of(node.start)
        || file.line_of(file.token_after(node)?.start()) == file.line_of(node.end);

    // The first of the comments on the lines directly before the member.
    let mut first_leading_comment = None;
    let mut next = node;
    for comment in file.comments_before(node).rev() {
        let comment = comment.span();
        if !starts_on_own_line(comment) || file.line_of(next.start) - file.line_of(comment.end) > 1 {
            break;
        }
        first_leading_comment = Some(comment);
        next = comment;
    }
    // A comment after the member on its line might describe what else is on the line.
    let last_item_to_remove = match shares_line_with_another_token {
        true => node,
        false => file
            .comments_after(node)
            .rfind(|comment| file.line_of(comment.start()) == file.line_of(node.end))
            .map_or(node, Token::span),
    };

    let next_token = file.tokens_after(last_item_to_remove).with_comments().next()?;
    let next_token_starts_on_new_line = file.line_of(next_token.start()) > file.line_of(last_item_to_remove.end);
    let (mut start, mut end) = (node.start, last_item_to_remove.end);
    if let Some(first) = first_leading_comment.filter(|_| !shares_line_with_another_token) {
        (start, end) = match next_token_starts_on_new_line {
            true => (line_start_index(first.start), line_start_index(next_token.start())),
            false => (first.start, next_token.start()),
        };
    } else if starts_on_own_line(node) && next_token_starts_on_new_line {
        (start, end) = (line_start_index(node.start), line_start_index(next_token.start()));
    } else if file.line_of(previous_token.end()) == file.line_of(node.start) {
        start = previous_token.end();
    } else if !next_token_starts_on_new_line {
        end = next_token.start();
    }
    Some(Span::new(start, end))
}

fn remove_member<'a>(fixer: Fixer<'a>, member: Member<'a>) -> Option<Vec<Fix>> {
    let file = fixer.file();
    let mut fixes = vec![fixer.remove(get_member_removal_range(file, member)?)];
    // What follows could continue the member before.
    if ast_utils::can_continue_expression_in_class_body(&file.token_after(member)?)
        && ast_utils::needs_preceding_semicolon(member)
    {
        fixes.push(fixer.insert_after(file.token_before(member)?, ";"));
    }
    Some(fixes)
}

impl NoUnusedPrivateClassMembers {
    fn collect_members<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        if cx.language().is_oxlint {
            // A method without a body is none, nor is an `accessor`.
            let is_element = |member: &Member<'a>| {
                !member.flags().contains(Flags::ACCESSOR) && member.func().is_none_or(Func::has_body)
            };
            for member in class.members().iter().filter(is_element) {
                if let Some(KeyKind::Private(name)) = member.key().map(Key::kind) {
                    cx.state.declared.push((class, name, member));
                }
            }
            return;
        }
        for member in class.members() {
            let Some(KeyKind::Private(name)) = member.key().map(Key::kind) else {
                continue;
            };
            if member.flags().contains(Flags::ACCESSOR) {
                cx.state.usages.push((Node::Member(member), name));
                continue;
            }
            cx.state.members.insert(
                (class, name),
                PrivateMember {
                    declared: member,
                    is_accessor: matches!(member.kind(), MemberKind::Getter | MemberKind::Setter),
                    has_reference: false,
                    is_used: false,
                },
            );
        }
    }

    fn collect_usage<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.kind() {
            ExprKind::Dot { name, .. } if cx.text().get(name.start() as usize) == Some(&b'#') => {
                cx.state.usages.push((Node::Expr(e), name.name()));
            }
            ExprKind::PrivateIdentifier(name) => cx.state.usages.push((Node::Expr(e), name)),
            _ => {}
        }
    }

    /// oxlint looks at each class alone: a name in a class in the class is not looked for further out. A method is used by
    /// any `a.#x` or `#x in a`, a field by an `a.#x` whose value goes somewhere. A getter and a setter are two members.
    fn finish_as_oxlint<'a>(&self, cx: &mut Cx<'a, Self>) {
        let State { declared, usages, .. } = std::mem::take(&mut cx.state);
        if declared.is_empty() {
            return;
        }
        let mut classes: AncestorMemo<'a, Class<'a>> = AncestorMemo::default();
        // What is referred to, and whether it is read.
        let mut referenced: FxHashMap<(Class<'a>, Name<'a>), bool> = FxHashMap::default();
        for (usage, name) in usages {
            if let Node::Expr(e) = usage
                && let Some(class) = classes.find(usage, class_of_member)
            {
                let is_read = referenced.entry((class, name)).or_insert(false);
                *is_read = *is_read || (e.tag() == ExprTag::Dot && is_read_for_oxlint(e));
            }
        }
        for (class, name, member) in declared {
            let is_used = (referenced.get(&(class, name)))
                .is_some_and(|is_read| *is_read || member.kind() != MemberKind::Property);
            if let Some(key) = member.key().filter(|_| !is_used) {
                cx.report(key.span(cx.file()), UNUSED_PRIVATE_CLASS_MEMBER)
                    .data("classMemberName", name.bytes().get(1..).unwrap_or_default());
            }
        }
    }
}

impl Rule for NoUnusedPrivateClassMembers {
    const META: Meta = Meta::eslint("no-unused-private-class-members", Kind::Problem)
        .has_suggestions()
        .recommended()
        .reports_on_exit();
    const ON: On = On::new()
        .classes()
        .exprs(&[ExprTag::Dot, ExprTag::PrivateIdentifier])
        .finish();
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoUnusedPrivateClassMembers
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        (file.has_classes() && strings::contains_char(file.text(), b'#')).then(State::default)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        self.collect_usage(e, cx);
    }

    fn class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        self.collect_members(class, cx);
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        if cx.language().is_oxlint {
            self.finish_as_oxlint(cx);
            return;
        }
        let State { mut members, usages, .. } = std::mem::take(&mut cx.state);
        if members.is_empty() {
            return;
        }
        // The class whose body a node is in.
        let mut classes: AncestorMemo<'a, Class<'a>> = AncestorMemo::default();
        for (usage, name) in usages {
            let mut inner = usage;
            while let Some(class) = classes.find(inner, class_of_member) {
                if let Some(member) = members.get_mut(&(class, name)) {
                    if !member.is_used {
                        member.has_reference = true;
                        member.is_used = member.is_accessor
                            || !matches!(usage, Node::Expr(e) if e.tag() == ExprTag::Dot && is_write_only(e));
                    }
                    break;
                }
                inner = Node::Class(class);
            }
        }
        for ((_, name), member) in &members {
            let (declared, has_reference) = (member.declared, member.has_reference);
            let Some(key) = declared.key().filter(|_| !member.is_used) else {
                continue;
            };
            cx.report(key.span(cx.file()), UNUSED_PRIVATE_CLASS_MEMBER)
                .data("classMemberName", name.bytes())
                .suggest_with(
                    REMOVE_UNUSED_PRIVATE_CLASS_MEMBER,
                    &[("classMemberName", name.bytes())],
                    |fixer| match has_reference {
                        true => None,
                        false => remove_member(fixer, declared),
                    },
                );
        }
    }
}
