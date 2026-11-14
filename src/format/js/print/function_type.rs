//! Function types, and the interface and type literal signatures that have parameters.

use super::function::write_parameters_and_return_type;
use super::parameters::FormatFormalParameters;
use super::type_parameters::type_parameters;
use crate::js::format::{FormatReturnTypeOfFunctionType, FormatTypeAnnotation};
use crate::js::utils::object::format_computed_or_property_key;
use crate::prelude::*;
use crate::{format_args, write};

/// `(a: A) => R`, `new (a: A) => R`, `abstract new (a: A) => R`
pub(crate) fn write_ts_function_type<'a>(ty: TypeNode<'a>, func: Func<'a>, f: &mut Formatter<'a>) {
    if f.file().is_flow() && super::flow::write_function_type_keyword(ty, func, f) {
        return;
    }
    let signature = format_with(|f| format_grouped_parameters_with_return_type(func, true, f));
    match func.kind() {
        FnKind::ConstructorType => write!(
            f,
            group(&format_args!(
                func.flags()
                    .contains(Flags::ABSTRACT)
                    .then_some("abstract "),
                "new",
                space(),
                signature
            ))
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

/// `get `, `set `
pub(crate) fn write_accessor_keyword(kind: MemberKind, f: &mut Formatter<'_>) {
    match kind {
        MemberKind::Getter => write!(f, ["get", space()]),
        MemberKind::Setter => write!(f, ["set", space()]),
        _ => {}
    }
}

/// `a(b: B): R`, `get a(): R`, `set a(b: B)`
pub(crate) fn write_ts_method_signature<'a>(
    member: Member<'a>,
    func: Func<'a>,
    f: &mut Formatter<'a>,
) {
    let format_inner = format_with(|f| {
        write_accessor_keyword(member.kind(), f);
        if let Some(key) = member.key() {
            format_computed_or_property_key(key, AstNodes::TSMethodSignature(member), f);
        }
        write!(f, member.flags().contains(Flags::OPTIONAL).then_some("?"));

        let format_return_type = format_with(|f| write!(f, group(&FormatReturnType(func))));
        write_parameters_and_return_type(
            func,
            &FormatAllParameters(func).memoized(),
            &format_return_type.memoized(),
            f,
        );
    });
    write!(f, group(&format_inner));
}

/// The type parameters, parameters and return type of a function type or an unnamed signature.
fn format_grouped_parameters_with_return_type<'a>(
    func: Func<'a>,
    is_function_or_constructor_type: bool,
    f: &mut Formatter<'a>,
) {
    group(&format_with(|f| {
        let format_return_type = format_with(|f| {
            write!(
                f,
                [
                    is_function_or_constructor_type.then_some(space()),
                    FormatReturnType(func)
                ]
            )
        });
        write_parameters_and_return_type(
            func,
            &FormatAllParameters(func).memoized(),
            &format_return_type.memoized(),
            f,
        );
    }))
    .fmt(f);
}

/// `<T>(a: A)`
struct FormatAllParameters<'a>(Func<'a>);

impl<'a> Format<'a> for FormatAllParameters<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let type_parameters = type_parameters(self.0.type_params(), Node::Func(self.0));
        write!(f, [type_parameters, FormatFormalParameters(self.0)]);
    }
}

/// `: R`, `=> R`
struct FormatReturnType<'a>(Func<'a>);

impl<'a> Format<'a> for FormatReturnType<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let Some(return_type) = self.0.return_type() else {
            return;
        };
        match self.0.owner() {
            Node::Type(_) => write!(f, FormatReturnTypeOfFunctionType(return_type)),
            _ => write!(f, FormatTypeAnnotation(return_type)),
        }
    }
}
