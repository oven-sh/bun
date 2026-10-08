//! Function types, and the signatures of interfaces and type literals that have parameters.

use super::function::should_group_function_parameters;
use super::parameters::FormatFormalParameters;
use super::type_parameters::type_parameters;
use crate::js::format::FormatTypeAnnotation;
use crate::js::utils::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use crate::js::utils::object::format_computed_or_property_key;
use crate::js::utils::typescript::end_of_line_comments;
use crate::prelude::*;
use crate::{format_args, write};

/// `(a: A) => R`, `new (a: A) => R`, `abstract new (a: A) => R`
pub(crate) fn write_ts_function_type<'a>(_ty: TypeNode<'a>, func: Func<'a>, f: &mut Formatter<'a>) {
    let signature = format_with(|f| format_grouped_parameters_with_return_type(func, true, f));
    match func.kind() {
        FnKind::ConstructorType => write!(
            f,
            group(&format_args!(func.flags().contains(Flags::ABSTRACT).then_some("abstract "), "new", space(), signature))
        ),
        _ => write!(f, signature),
    }
}

/// `(a: A): R`
pub(crate) fn write_ts_call_signature_declaration<'a>(func: Func<'a>, f: &mut Formatter<'a>) {
    format_grouped_parameters_with_return_type(func, false, f);
}

/// `new (a: A): R`
pub(crate) fn write_ts_construct_signature_declaration<'a>(func: Func<'a>, f: &mut Formatter<'a>) {
    let signature = format_with(|f| format_grouped_parameters_with_return_type(func, false, f));
    write!(f, group(&format_args!("new", space(), signature)));
}

/// `a(b: B): R`, `get a(): R`, `set a(b: B)`
pub(crate) fn write_ts_method_signature<'a>(member: Member<'a>, func: Func<'a>, f: &mut Formatter<'a>) {
    let format_inner = format_with(|f| {
        match member.kind() {
            MemberKind::Getter => write!(f, ["get", space()]),
            MemberKind::Setter => write!(f, ["set", space()]),
            _ => {}
        }
        if let Some(key) = member.key() {
            format_computed_or_property_key(key, AstNodes::TSMethodSignature(member), f);
        }
        if func.type_params().is_empty() {
            write!(f, FormatCommentsAroundParenthesis(func));
        }
        write!(f, member.flags().contains(Flags::OPTIONAL).then_some("?"));

        let format_type_parameters = FormatTypeParameters(func).memoized();
        let format_parameters = FormatFormalParameters(func).memoized();
        format_type_parameters.inspect(f);
        format_parameters.inspect(f);
        let format_return_type = FormatReturnType(func).memoized();

        match should_group_function_parameters(func, &format_return_type, f) {
            true => write!(f, group(&format_args!(format_type_parameters, format_parameters))),
            false => write!(f, [format_type_parameters, format_parameters]),
        }
        write!(f, group(&format_return_type));
    });
    write!(f, group(&format_inner));
}

pub(crate) fn format_grouped_parameters_with_return_type<'a>(
    func: Func<'a>,
    is_function_or_constructor_type: bool,
    f: &mut Formatter<'a>,
) {
    group(&format_with(|f| {
        let format_type_parameters = FormatTypeParameters(func).memoized();
        let format_parameters = FormatFormalParameters(func).memoized();
        let return_type = FormatReturnType(func);
        let format_return_type = FormatNodeWithoutTrailingComments(&return_type).memoized();

        format_type_parameters.inspect(f);
        format_parameters.inspect(f);

        match should_group_function_parameters(func, &format_return_type, f) {
            true => write!(f, group(&format_args!(format_type_parameters, format_parameters))),
            false => write!(f, [format_type_parameters, format_parameters]),
        }
        write!(f, [is_function_or_constructor_type.then_some(space()), format_return_type]);
    }))
    .fmt(f);
}

/// The type parameters of a signature, with the comments after them.
struct FormatTypeParameters<'a>(Func<'a>);

impl<'a> Format<'a> for FormatTypeParameters<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let params = self.0.type_params();
        if !params.is_empty() {
            write!(f, [type_parameters(params, Node::Func(self.0)), FormatCommentsAroundParenthesis(self.0)]);
        }
    }
}

/// The comments that trail what is before the `(` of a signature: a name or type parameters.
///
/// - If there are no parameters, those before the `(`, which there is nothing for to lead.
/// - Those after the `(` on the same line, if nothing else follows on that line.
struct FormatCommentsAroundParenthesis<'a>(Func<'a>);

impl<'a> Format<'a> for FormatCommentsAroundParenthesis<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let Some(span) = self.0.params_span().filter(|_| !f.is_quiet()) else {
            return;
        };
        let comments = match self.0.this_param().or_else(|| self.0.params().first()) {
            Some(first) => end_of_line_comments(f.comments().comments_before(first.span().start)),
            None => f.comments().comments_before(span.start),
        };
        write!(f, FormatTrailingComments::Comments(comments));
    }
}

/// `: R`, `=> R`. Prettier's `printTypeAnnotationProperty`: there is a space between the `)` and the
/// comments before a `:`.
struct FormatReturnType<'a>(Func<'a>);

impl Spanned for FormatReturnType<'_> {
    fn span(&self) -> Span {
        self.0.return_type().map_or(Span::default(), TypeNode::annotation_span)
    }
}

impl<'a> Format<'a> for FormatReturnType<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let Some(return_type) = self.0.return_type().map(FormatTypeAnnotation) else {
            return;
        };
        let has_comment = !f.is_quiet() && f.comments().has_comment_before(return_type.span().start);
        write!(f, [has_comment.then_some(space()), return_type]);
    }
}
