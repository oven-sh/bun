//! Function types, and the signatures of interfaces and type literals that have parameters.

use super::function::should_group_function_parameters;
use super::parameters::FormatFormalParameters;
use super::type_parameters::type_parameters;
use crate::js::format::FormatTypeAnnotation;
use crate::js::utils::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use crate::js::utils::object::format_computed_or_property_key;
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
        // There is nothing after the name that the comments before the `(` could lead.
        if !f.is_quiet()
            && func.type_params().is_empty()
            && func.params().is_empty()
            && func.this_param().is_none()
            && let Some(params) = func.params_span()
        {
            write!(f, FormatTrailingComments::Comments(f.comments().comments_before(params.start)));
        }
        write!(f, member.flags().contains(Flags::OPTIONAL).then_some("?"));

        let format_type_parameters = type_parameters(func.type_params(), Node::Func(func)).memoized();
        let format_parameters = FormatFormalParameters(func).memoized();
        format_type_parameters.inspect(f);
        format_parameters.inspect(f);
        let format_return_type = func.return_type().map(FormatTypeAnnotation).memoized();

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
        let format_type_parameters = type_parameters(func.type_params(), Node::Func(func)).memoized();
        let format_parameters = FormatFormalParameters(func).memoized();
        let return_type = func.return_type().map(FormatTypeAnnotation);
        let format_return_type = return_type.as_ref().map(FormatNodeWithoutTrailingComments).memoized();

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
