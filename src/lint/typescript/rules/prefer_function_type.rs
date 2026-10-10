use bun_lint::ast::walk::{Visitor, walk_node};
use bun_lint::prelude::*;

/// Enforce using function types instead of interfaces with call signatures.
pub struct PreferFunctionType;

const FUNCTION_TYPE_OVER_CALLABLE_TYPE: Message = Message::new(
    "functionTypeOverCallableType",
    "{{ literalOrInterface }} only has a call signature, you should use a function type instead.",
);
const UNEXPECTED_THIS_ON_FUNCTION_ONLY_INTERFACE: Message = Message::new(
    "unexpectedThisOnFunctionOnlyInterface",
    "`this` refers to the function type '{{ interfaceName }}', did you intend to use a generic `this` parameter like `<Self>(this: Self, ...) => Self` instead?",
);

/// What has the member.
#[derive(Copy, Clone)]
enum Owner<'a> {
    Interface(Interface<'a>),
    TypeLiteral(TypeNode<'a>),
}

/// Finds the first `this` type that is not in a type literal, where it is invalid.
#[derive(Default)]
struct ThisTypes {
    literal_nesting: u32,
    first: Option<Span>,
}

impl<'a> Visitor<'a> for ThisTypes {
    fn enter(&mut self, node: Node<'a>) {
        let Node::Type(ty) = node else {
            return;
        };
        let this = match ty.kind() {
            TypeKind::Object(_) => {
                self.literal_nesting += 1;
                return;
            }
            TypeKind::Keyword(Keyword::This) => ty.span(),
            TypeKind::Predicate { param, .. } if param.is("this") => match ty.predicate_param() {
                Some(param) => param.span(),
                None => return,
            },
            _ => return,
        };
        if self.literal_nesting == 0 && self.first.is_none() {
            self.first = Some(this);
        }
    }

    fn exit(&mut self, node: Node<'a>) {
        if matches!(node, Node::Type(ty) if ty.tag() == TypeTag::Object) {
            self.literal_nesting -= 1;
        }
    }
}

/// Whether the interface extends anything but `Function`.
fn has_one_supertype(interface: Interface) -> bool {
    let extends = interface.extends();
    match (extends.first(), extends.len()) {
        (None, _) => false,
        (Some(only), 1) => !matches!(only.kind(), TypeKind::Ref { name, .. } if name.is("Function")),
        _ => true,
    }
}

fn should_wrap_suggestion(parent: Node) -> bool {
    matches!(parent, Node::Type(parent) if matches!(
        parent.kind(),
        TypeKind::Union(_) | TypeKind::Intersection(_) | TypeKind::Array(_)
    ))
}

fn comment_text(comment: Token) -> Vec<u8> {
    match comment.kind() {
        TokenKind::Line => [&b"//"[..], comment.comment_value()].concat(),
        _ => [&b"/*"[..], comment.comment_value(), b"*/"].concat(),
    }
}

/// The signature `member` as a function type.
fn function_type(member: Member, return_type: TypeNode) -> Option<Vec<u8>> {
    let text = member.text();
    let colon = return_type.annotation_span().start.checked_sub(member.span().start)? as usize;
    let mut suggestion = [text.get(..colon)?, b" =>", text.get(colon + 1..)?].concat();
    if suggestion.ends_with(b";") {
        suggestion.pop();
    }
    Some(suggestion)
}

fn fix<'a>(
    fixer: Fixer<'a>,
    member: Member<'a>,
    return_type: TypeNode<'a>,
    owner: Owner<'a>,
) -> Option<Vec<Fix>> {
    let file = fixer.file();
    let has_semicolon = member.text().ends_with(b";");
    let mut suggestion = function_type(member, return_type)?;
    // What is replaced, and the `export` before it.
    let (replaced, export) = match owner {
        Owner::TypeLiteral(literal) => {
            if should_wrap_suggestion(literal.parent()) {
                suggestion.insert(0, b'(');
                suggestion.push(b')');
            }
            (literal.span(), None)
        }
        Owner::Interface(interface) => {
            let name = match interface.type_params().angle_brackets_span() {
                Some(type_params) => file.slice(interface.name().span().to(type_params)),
                None => interface.name().bytes(),
            };
            suggestion = [&b"type "[..], name, b" = ", &suggestion[..]].concat();
            // oxlint always ends the alias.
            if has_semicolon || file.language().is_oxlint {
                suggestion.push(b';');
            }
            let statement = interface.stmt();
            (statement.span_without_export(), statement.export_span())
        }
    };
    let comments = file.comments_before(member).chain(file.comments_after(member));
    let Some(export) = export else {
        // Each goes before those before it.
        let line = file.line_of(member.span().start);
        let comments: Vec<Token<'a>> = comments.collect();
        let mut with_comments = Vec::new();
        for comment in comments.into_iter().rev() {
            with_comments.extend_from_slice(&comment_text(comment));
            with_comments.push(if file.line_of(comment.start()) == line { b' ' } else { b'\n' });
        }
        with_comments.extend_from_slice(&suggestion);
        return Some(vec![fixer.replace(replaced, with_comments)]);
    };
    // They go before the `export`, not between it and the declaration.
    let mut comments_text = Vec::new();
    for comment in comments {
        comments_text.extend_from_slice(&comment_text(comment));
        comments_text.push(b'\n');
    }
    Some(vec![
        fixer.insert_before(export, comments_text),
        fixer.replace(replaced, suggestion),
    ])
}

fn check_member<'a>(member: Member<'a>, owner: Owner<'a>, cx: &Cx<'a, PreferFunctionType>) {
    if !matches!(member.kind(), MemberKind::CallSignature | MemberKind::ConstructSignature) {
        return;
    }
    let Some(return_type) = member.func().and_then(Func::return_type) else {
        return;
    };
    let (phrase, is_default_export) = match owner {
        Owner::TypeLiteral(_) => ("Type literal", false),
        Owner::Interface(interface) => {
            let mut this_types = ThisTypes::default();
            walk_node(Node::Stmt(interface.stmt()), &mut this_types);
            if let Some(this) = this_types.first {
                let report = cx.report(this, UNEXPECTED_THIS_ON_FUNCTION_ONLY_INTERFACE);
                let report = report.data("interfaceName", interface.name());
                // For the help of oxlint.
                if cx.language().is_oxlint {
                    report.data("suggestion", function_type(member, return_type).unwrap_or_default());
                }
                return;
            }
            ("Interface", interface.stmt().is_default_export())
        }
    };
    let report = cx
        .report(member, FUNCTION_TYPE_OVER_CALLABLE_TYPE)
        .data("literalOrInterface", phrase);
    // For the help of oxlint.
    let report = match cx.language().is_oxlint {
        true => report.data("suggestion", function_type(member, return_type).unwrap_or_default()),
        false => report,
    };
    if !is_default_export {
        report.fix(|fixer| fix(fixer, member, return_type, owner));
    }
}

/// oxlint looks at a type literal that is a type annotation or the type of an alias, or a part of a union that is one
/// of these, or of an intersection that is the type of an alias. Not in `a as { (): void }` or among type arguments.
fn oxlint_looks_at(literal: TypeNode) -> bool {
    let is_annotated = |node: Node| matches!(node, Node::VarDecl(_) | Node::Param(_) | Node::Member(_) | Node::Func(_));
    let is_alias = |node: Node| matches!(node, Node::Stmt(it) if it.tag() == StmtTag::TypeAlias);
    if literal.is_parenthesized() {
        return false;
    }
    match literal.parent() {
        Node::Type(outer) if !outer.is_parenthesized() => match outer.tag() {
            TypeTag::Union => is_annotated(outer.parent()) || is_alias(outer.parent()),
            TypeTag::Intersection => is_alias(outer.parent()),
            _ => false,
        },
        parent => is_annotated(parent) || is_alias(parent),
    }
}

impl Rule for PreferFunctionType {
    const META: Meta = Meta::typescript("prefer-function-type", Kind::Suggestion)
        .fixable(Fixable::Code)
        .presets(Presets::STYLISTIC);
    const ON: On = On::new().stmts(&[StmtTag::Interface]).types(&[TypeTag::Object]);
    no_state!();

    fn new(_: &Options) -> Self {
        PreferFunctionType
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Interface(interface) = statement.kind() else {
            return;
        };
        let members = interface.members();
        if let Some(member) = members.first()
            && members.len() == 1
            && !has_one_supertype(interface)
        {
            check_member(member, Owner::Interface(interface), cx);
        }
    }

    fn ty<'a>(&self, literal: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        let TypeKind::Object(members) = literal.kind() else {
            return;
        };
        if let Some(member) = members.first()
            && members.len() == 1
            && (!cx.language().is_oxlint || oxlint_looks_at(literal))
        {
            check_member(member, Owner::TypeLiteral(literal), cx);
        }
    }
}
