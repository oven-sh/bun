use bun_sema::hir::{Chain, ExprId, ExprKind, MemberKey};
use smallvec::SmallVec;

use super::json_schema::{
    Source, WrittenSchema, accepts_only_valid_values, refuses_only_invalid_values,
};
use super::nodes::validation_nodes_of_unwritten_type;
use super::written_value::read_written_value;
use crate::builtins::id::BuiltinId;
use crate::ir::{ExpectedResultId, ValueId};
use crate::lower::call::{Arguments, CallSite, emit_call};
use crate::lower::{FileLowering, FunctionLowering};

// `assert` is not among them: it hands back a copy, which the function of the validator makes.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Method {
    Check,
    Parse,
}

struct ValidatorCall {
    method: Method,
    validator: ExprId,
    argument: ExprId,
    expected: ExpectedResultId,
}

fn find_method(name: &[u8]) -> Option<Method> {
    match name {
        b"check" => Some(Method::Check),
        b"parse" => Some(Method::Parse),
        _ => None,
    }
}

fn helper_of(method: Method) -> BuiltinId {
    match method {
        Method::Check => BuiltinId::CompilerHelpersCheckByValidator,
        Method::Parse => BuiltinId::CompilerHelpersParseByValidator,
    }
}

// `User.check(value)`, where the bindings of the program say that `User` is `new Bun.Validator(schema)`. `None`: the call is an ordinary call of the validator's own function, which
// `new` has compiled or has reported.
fn find_validator_call(
    file: &mut FileLowering<'_, '_, '_, '_>,
    call: ExprId,
) -> Option<ValidatorCall> {
    let hir = file.hir;
    let ExprKind::Call(id) = hir[call].kind else {
        return None;
    };
    let site = hir[id];
    let callee = file.skip_type_syntax(site.callee);
    let is_plain_access = matches!(
        hir[callee].kind,
        ExprKind::Dot {
            chain: Chain::No,
            ..
        }
    );
    if site.chain != Chain::No || !is_plain_access || !file.is_checked() {
        return None;
    }
    let (validator, MemberKey::Name(name)) = hir.member_key(callee)? else {
        return None;
    };
    let method = find_method(file.queries.atom_bytes(name))?;
    let mut arguments = hir.ids(site.args);
    let (Some(argument), None) = (arguments.next(), arguments.next()) else {
        return None;
    };
    if matches!(hir[argument].kind, ExprKind::Spread(_)) {
        return None;
    }

    let bindings = file.inputs.named_values;
    let creation = bindings.find_initializer(file.file, validator)?;
    let (schema, options) =
        bindings.find_arguments_of_new_validator(creation.file, creation.expr)?;
    // The constructor has compared the object with what the build read.
    let reading = read_written_value(file, creation.file, schema).ok()?;
    // Only a literal in the call: whoever else holds the options could change them.
    let options = match options {
        Some(options) => {
            let written = bindings.find_initializer(creation.file, options)?;
            Some(Some(written).filter(|written| written.holder.is_none())?)
        }
        None => None,
    };

    let ty = file.queries.validated_type(validator).ok()??;
    let position = hir[call].pos;
    let nodes = validation_nodes_of_unwritten_type(file, ty, position).ok()?;
    let source = match method {
        Method::Parse => Source::Text,
        Method::Check => Source::Value,
    };
    let (tree, literal) = file.queries.tree_of_written_value(&reading.value);
    let files = file.queries.files();
    let written = WrittenSchema {
        hir: tree,
        schema: literal,
        options: options.map(|options| (files.hir(options.file), options.expr)),
    };
    accepts_only_valid_values(file, &written, &nodes, source).ok()?;
    refuses_only_invalid_values(file, &written, &nodes, source).ok()?;
    let expected = file.add_expected_result(call, ty, nodes.to_vec()).ok()?;
    Some(ValidatorCall {
        method,
        validator,
        argument,
        expected,
    })
}

pub(in crate::lower) fn try_lower_validator_call(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
) -> Option<ValueId> {
    let found = find_validator_call(lowering.file, call)?;
    let validator = lowering.lower_expression(found.validator);
    let argument = lowering.lower_expression(found.argument);
    lowering.set_position(lowering.file.hir[call].pos);
    let helper = lowering.builder.builtin(helper_of(found.method));
    let site = CallSite {
        expected_result: Some(found.expected),
        ..CallSite::default()
    };
    // Both directions are shown: the schema is the one that was read, and what compiled code refuses is invalid.
    let yes = lowering.builder.boolean(true);
    let operands = Arguments::Values(SmallVec::from_slice(&[validator, argument, yes, yes]));
    let answer = emit_call(lowering, helper, None, operands, site);
    Some(match found.method {
        Method::Check => answer,
        Method::Parse => lowering.claim_call_result(call, answer),
    })
}
