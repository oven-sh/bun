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

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let State { mut members, usages } = std::mem::take(&mut cx.state);
        if members.is_empty() {
            return;
        }
        // The class whose body a node is in.
        let mut classes: AncestorMemo<'a, Class<'a>> = AncestorMemo::default();
        for (usage, name) in usages {
            let mut inner = usage;
            // The heritage and the decorators of a class are not in its body.
            while let Some(class) = classes.find(inner, |child, parent| match (parent, child) {
                (Node::Class(class), Node::Member(_)) => Some(class),
                _ => None,
            }) {
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
                // oxlint has the name without the `#`.
                .data("classMemberName", name.bytes().get(usize::from(cx.language().is_oxlint)..).unwrap_or_default())
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

impl Rule for NoUnusedPrivateClassMembers {
    const META: Meta = Meta::eslint("no-unused-private-class-members", Kind::Problem)
        .has_suggestions()
        .recommended();
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoUnusedPrivateClassMembers
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> State<'a> {
        if file.has_classes() && strings::contains_char(file.text(), b'#') {
            on.classes(Self::collect_members);
            on.exprs([ExprTag::Dot, ExprTag::PrivateIdentifier], Self::collect_usage);
            on.finish(Self::finish);
        }
        State::default()
    }
}
