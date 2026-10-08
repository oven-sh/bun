//! The types that take only a few lines each, and the members of interfaces and type literals.

use super::function_type::{
    write_ts_call_signature_declaration, write_ts_construct_signature_declaration, write_ts_method_signature,
};
use super::import_declaration::FormatStringLiteral;
use super::object_like::ObjectLike;
use super::type_parameters::type_arguments;
use crate::js::format::{FormatTypeAnnotation, identifier};
use crate::js::utils::conditional::ConditionalLike;
use crate::js::utils::number::format_number_token;
use crate::js::utils::object::{format_computed_or_property_key, should_preserve_quote};
use crate::js::utils::string::{FormatLiteralStringToken, StringLiteralParentKind};
use crate::js::utils::suppressed::FormatSuppressedNode;
use crate::prelude::*;
use crate::{best_fitting, format_args, write};

/// `A.B.C`. `parent`: what it is a name in.
pub(crate) fn entity_name<'a>(name: EntityName<'a>, parent: AstNodes<'a>) -> impl Format<'a> {
    format_with(move |f: &mut Formatter<'a>| {
        f.join_with(".").entries(name.parts().map(|part| identifier(part, parent)));
    })
}

/// `A.B<C>`
pub(crate) fn write_ts_type_reference<'a>(
    ty: TypeNode<'a>,
    name: EntityName<'a>,
    args: List<'a, TypeNode<'a>>,
    f: &mut Formatter<'a>,
) {
    let wrap = is_leftmost_intrinsic_in_type_alias(ty, name, args);
    write!(
        f,
        [
            wrap.then_some("("),
            entity_name(name, ty.as_ast_nodes()),
            type_arguments(args, Node::Type(ty)),
            wrap.then_some(")")
        ]
    );
}

/// `type A = (intrinsic)` is a reference to a type of that name. Without the parentheses it is the
/// keyword.
fn is_leftmost_intrinsic_in_type_alias<'a>(ty: TypeNode<'a>, name: EntityName<'a>, args: List<'a, TypeNode<'a>>) -> bool {
    if !name.is("intrinsic") || !args.is_empty() {
        return false;
    }
    let start = ty.span().start;
    let mut parent = ty.ast_parent();
    loop {
        match parent {
            AstNodes::TSTypeAliasDeclaration(_) => return true,
            AstNodes::TSUnionType(it)
            | AstNodes::TSIntersectionType(it)
            | AstNodes::TSConditionalType(it)
            | AstNodes::TSArrayType(it)
                if it.span().start == start =>
            {
                parent = parent.parent();
            }
            _ => return false,
        }
    }
}

/// `"a"`, `1`, `-1`, `1n`
pub(crate) fn write_ts_literal_type<'a>(ty: TypeNode<'a>, f: &mut Formatter<'a>) {
    let text = ty.text();
    match ty.kind() {
        TypeKind::StringLit(_) => {
            write!(f, FormatLiteralStringToken::new(text, false, StringLiteralParentKind::Expression));
        }
        _ => {
            let (sign, digits) = match text.strip_prefix(b"-") {
                Some(digits) => (Some("-"), digits.trim_ascii_start()),
                None => (None, text),
            };
            match digits.ends_with(b"n") {
                true => write!(f, [sign, text_without_whitespace(&digits.to_ascii_lowercase())]),
                false => write!(f, [sign, format_number_token(digits)]),
            }
        }
    }
}

/// `{ a: A }`
pub(crate) fn write_ts_type_literal<'a>(ty: TypeNode<'a>, members: List<'a, Member<'a>>, f: &mut Formatter<'a>) {
    ObjectLike::TSTypeLiteral(ty, members).fmt(f);
}

/// The members of an interface or a type literal, with their separators.
pub(crate) fn write_ts_signatures<'a>(members: List<'a, Member<'a>>, f: &mut Formatter<'a>) {
    let is_consistent = f.options().quote_properties.is_consistent();
    if is_consistent {
        let quote_needed = members.iter().any(|signature| {
            matches!(signature.as_ast_nodes(), AstNodes::TSPropertySignature(_) | AstNodes::TSMethodSignature(_))
                && signature.key().is_some_and(|key| should_preserve_quote(key, f))
        });
        f.context_mut().push_quote_needed(quote_needed);
    }

    let mut joiner = f.join_nodes_with_soft_line();
    let mut iter = members.iter().peekable();
    while let Some(signature) = iter.next() {
        joiner.entry(
            signature.span(),
            &FormatTSSignature {
                signature,
                next_signature: iter.peek().copied(),
            },
        );
    }

    if is_consistent {
        f.context_mut().pop_quote_needed();
    }
}

/// A member and the `;` after it.
struct FormatTSSignature<'a> {
    signature: Member<'a>,
    next_signature: Option<Member<'a>>,
}

impl<'a> Format<'a> for FormatTSSignature<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let (signature, span) = (self.signature, self.signature.span());
        if !f.is_quiet() {
            if f.comments().is_suppressed(span.start) {
                return write!(f, signature);
            }
            if f.comments().has_trailing_suppression_comment(span.end) {
                let comments = f.comments().end_of_line_comments_after(span.end);
                return write!(f, [FormatSuppressedNode(span), FormatTrailingComments::Comments(comments)]);
            }
        }

        write!(f, signature);

        match f.options().semicolons {
            Semicolons::Always => match self.next_signature {
                Some(_) => write!(f, ";"),
                None => write!(f, if_group_breaks(&";")),
            },
            Semicolons::AsNeeded => {
                // `a: string; <T>(): void`, `a; (): void`, `a; b(): void`: what follows would be
                // taken for the rest of the property.
                let needs_semicolon = matches!(signature.as_ast_nodes(), AstNodes::TSPropertySignature(_))
                    && !signature.key().is_some_and(Key::is_computed)
                    && self.next_signature.is_some_and(|next| match next.as_ast_nodes() {
                        AstNodes::TSCallSignatureDeclaration(_) => {
                            signature.ty().is_none() || next.func().is_some_and(|it| !it.type_params().is_empty())
                        }
                        AstNodes::TSMethodSignature(_) => signature.ty().is_none(),
                        _ => false,
                    });
                if needs_semicolon {
                    write!(f, ";");
                } else if self.next_signature.is_some() {
                    write!(f, if_group_fits_on_line(&";"));
                }
            }
        }
    }
}

/// A member of an interface or a type literal that is not an index signature.
pub(crate) fn write_ts_signature<'a>(member: Member<'a>, f: &mut Formatter<'a>) {
    let node = member.as_ast_nodes();
    match (node, member.func()) {
        (AstNodes::TSCallSignatureDeclaration(_), Some(func)) => write_ts_call_signature_declaration(func, f),
        (AstNodes::TSConstructSignatureDeclaration(_), Some(func)) => write_ts_construct_signature_declaration(func, f),
        (AstNodes::TSMethodSignature(_), Some(func)) => write_ts_method_signature(member, func, f),
        _ => {
            write!(f, member.flags().contains(Flags::READONLY).then_some("readonly "));
            if let Some(key) = member.key() {
                format_computed_or_property_key(key, node, f);
            }
            write!(f, [member.flags().contains(Flags::OPTIONAL).then_some("?"), member.ty().map(FormatTypeAnnotation)]);
        }
    }
}

/// `A extends B ? C : D`
pub(crate) fn write_ts_conditional_type<'a>(ty: TypeNode<'a>, f: &mut Formatter<'a>) {
    ConditionalLike::TSConditionalType(ty).fmt(f);
}

/// `typeof a.b<T>`
pub(crate) fn write_ts_type_query<'a>(
    ty: TypeNode<'a>,
    expr: Expr<'a>,
    args: List<'a, TypeNode<'a>>,
    f: &mut Formatter<'a>,
) {
    write!(f, ["typeof ", expr, type_arguments(args, Node::Type(ty))]);
}

/// `import("a").B<C>`, `typeof import("a")`
pub(crate) fn write_ts_import_type<'a>(ty: TypeNode<'a>, f: &mut Formatter<'a>) {
    let TypeKind::Import {
        name,
        args,
        is_typeof,
        ..
    } = ty.kind()
    else {
        return;
    };
    let Some(source) = ty.import_source_span() else {
        return write!(f, FormatSuppressedNode(ty.span()));
    };
    let node = AstNodes::TSImportType(ty);
    write!(f, [is_typeof.then_some("typeof "), "import("]);

    let has_comment = f.comments().has_comment_before(source.start);
    let format_argument = FormatStringLiteral {
        span: source,
        parent: node,
    }
    .memoized();

    if let Some(options) = ty.import_attributes() {
        // The options are an object literal that is not kept as one.
        let format_options = FormatSuppressedNode(options.options_span()).memoized();
        let format_inner = format_args!(format_argument, ",", soft_line_break_or_space(), format_options);
        match has_comment {
            true => write!(f, soft_block_indent(&format_inner)),
            false => write!(f, best_fitting!(format_inner, soft_block_indent(&format_inner))),
        }
    } else if has_comment {
        write!(f, soft_block_indent(&format_argument));
    } else {
        write!(f, format_argument);
    }

    write!(f, ")");
    if !name.is_empty() {
        write!(f, [".", entity_name(name, node)]);
    }
    write!(f, type_arguments(args, Node::Type(ty)));
}

/// `a is T`, `asserts a`, `asserts a is T`
pub(crate) fn write_ts_type_predicate<'a>(ty: TypeNode<'a>, f: &mut Formatter<'a>) {
    let TypeKind::Predicate {
        ty: type_annotation,
        asserts,
        ..
    } = ty.kind()
    else {
        return;
    };
    write!(f, [asserts.then_some("asserts "), ty.predicate_param().map(|it| identifier(it, AstNodes::TSTypePredicate(ty)))]);
    if let Some(type_annotation) = type_annotation {
        write!(f, [space(), "is", space(), FormatTypeAnnotation(type_annotation)]);
    }
}

/// The `: T` around `ty`. For the return type of a function type, `=> T`.
pub(crate) fn write_ts_type_annotation<'a>(ty: TypeNode<'a>, f: &mut Formatter<'a>) {
    match AstNodes::TSTypeAnnotation(ty).parent() {
        AstNodes::TSFunctionType(_) | AstNodes::TSConstructorType(_) => write!(f, ["=>", space(), ty]),
        AstNodes::TSTypePredicate(_) => write!(f, ty),
        _ => write!(f, [":", space(), ty]),
    }
}
