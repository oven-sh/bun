use crate::rules::no_unnecessary_template_expression::min_precedence_at;
use bun_lint::ast::walk::{Visitor, walk_node};
use bun_lint::prelude::*;
use bun_lint::utils::visible::{is_declared_again, is_only_declaration};

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

/// The node that declares the member.
#[derive(Copy, Clone)]
enum Owner<'a> {
    Interface(Interface<'a>),
    TypeLiteral(TypeNode<'a>),
}

/// Finds the first `this` type outside a type literal. Inside a type literal `this` is invalid.
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

/// True if the interface extends anything other than `Function`.
fn has_one_supertype(interface: Interface) -> bool {
    let extends = interface.extends();
    match (extends.first(), extends.len()) {
        (None, _) => false,
        (Some(only), 1) => !matches!(only.kind(), TypeKind::Ref { name, .. } if name.is("Function")),
        _ => true,
    }
}

/// Prints the signature `member` as a function type.
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
    let is_terminated = matches!(member.text().last(), Some(b';' | b','));
    let mut suggestion = function_type(member, return_type)?;
    // `function_type` keeps a trailing comma because oxlint's help text includes it.
    if suggestion.ends_with(b",") {
        suggestion.pop();
    }
    // The span to replace, the name with its type parameters, and the statement's span starting at `export`.
    let (replaced, name, export) = match owner {
        Owner::TypeLiteral(literal) => {
            if min_precedence_at(literal) > 0 {
                suggestion.insert(0, b'(');
                suggestion.push(b')');
            }
            (literal.span(), None, None)
        }
        Owner::Interface(interface) => {
            let name = interface.name().span();
            let name = interface.type_params().angle_brackets_span().map_or(name, |it| name.to(it));
            suggestion = [&b"type "[..], file.slice(name), b" = ", &suggestion[..]].concat();
            // oxlint always ends the alias with `;`.
            if is_terminated || file.language().is_oxlint {
                suggestion.push(b';');
            }
            let statement = interface.stmt();
            (statement.span_without_export(), Some(name), statement.export_span())
        }
    };
    let is_copied = |it: &Token| member.span().contains(it.span()) || name.is_some_and(|name| name.contains(it.span()));
    let line = file.line_of(member.span().start);
    // Comments that aren't copied along with the member or the name move to the front, before any `export`.
    let mut comments = Vec::new();
    for comment in file.comments_in(replaced).filter(|it| !is_copied(it)) {
        comments.extend_from_slice(comment.text());
        let can_share_the_line =
            comment.kind() == TokenKind::Block && export.is_none() && file.line_of(comment.start()) == line;
        comments.push(if can_share_the_line { b' ' } else { b'\n' });
    }
    // A comment like `// @ts-expect-error` applies to the next line, so don't put another comment between them.
    if !comments.is_empty() && fixer.has_directive_before(export.unwrap_or(replaced))
        || fixer.has_directive_before(member) && file.comments_after(member).next().is_some()
    {
        return None;
    }
    Some(match export {
        Some(export) => vec![fixer.insert_before(export, comments), fixer.replace(replaced, suggestion)],
        None => vec![fixer.replace(replaced, [comments, suggestion].concat())],
    })
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
                // For oxlint's help text.
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
    // For oxlint's help text.
    let report = match cx.language().is_oxlint {
        true => report.data("suggestion", function_type(member, return_type).unwrap_or_default()),
        false => report,
    };
    if !is_default_export {
        let is_safe = || match owner {
            Owner::TypeLiteral(_) => true,
            Owner::Interface(interface) => is_only_declaration(interface),
        };
        let is_duplicate = || matches!(owner, Owner::Interface(interface) if is_declared_again(interface));
        report.fix_where_safe(is_safe, |fixer| fix(fixer, member, return_type, owner).filter(|_| !is_duplicate()));
    }
}

/// oxlint only checks a type literal that's a type annotation or an alias's type, a member of a union in one of those
/// positions, or a member of an intersection that's an alias's type. It skips `a as { (): void }` and type arguments.
fn oxlint_checks_literal(literal: TypeNode) -> bool {
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
            && matches!(member.kind(), MemberKind::CallSignature | MemberKind::ConstructSignature)
            && (!cx.language().is_oxlint || oxlint_checks_literal(literal))
        {
            check_member(member, Owner::TypeLiteral(literal), cx);
        }
    }
}
