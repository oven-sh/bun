use bun_sema::hir::{Call, Chain, ExprId, ExprKind};
use smallvec::SmallVec;

use super::callee::find_callee_name;
use super::{Arguments, CallSite, Callee};
use crate::builtins::{EvaluatedText, EvaluatedTextForm};
use crate::ir::{BlockId, Edge, FunctionKey, ValueId};
use crate::lower::expression::{self, Tail};
use crate::lower::{FunctionLowering, condition};

pub(super) fn lower_evaluated_text_call(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
    text: &EvaluatedText,
    exit: Option<BlockId>,
) -> ValueId {
    let hir = lowering.file.hir;
    let (ExprKind::Call(site) | ExprKind::New(site)) = hir[call].kind else {
        unreachable!("evaluated text is an argument of a Call or a New expression");
    };
    let site = hir[site];
    let is_construct = matches!(hir[call].kind, ExprKind::New(_));
    let callee = lower_site_callee(lowering, site, is_construct, exit);
    let arguments = super::lower_arguments(lowering, site.args);
    let Some(function) = lowering.file.evaluated_function(call) else {
        return emit_ordinary(lowering, call, is_construct, callee, arguments);
    };
    let compiled = lowering
        .file
        .reference_function(FunctionKey::Source(function));

    let position = super::last_mapped_position(lowering.file, site.callee);
    lowering.set_position(position);
    let expected = expression::emit_locked_builtin(lowering, text.callee.id);
    let test = lowering.builder.strict_eq(callee.function, expected);
    let matches = lowering.create_block();
    let differs = lowering.create_block();
    let join = lowering.create_block();
    let result = lowering.builder.create_variable(None);
    let other_callee = Callee {
        function: lowering.builder.add_edge_result(differs),
        key: None,
        ..callee
    };
    let differs_edge = Edge::with_proofs(differs, &[0]);
    lowering
        .builder
        .branch(test, Edge::to(matches), differs_edge);

    lowering.continue_in(matches);
    let closure = lowering.builder.new_closure(compiled, &[]);
    let evaluated = match text.form {
        EvaluatedTextForm::FunctionBody => closure,
        EvaluatedTextForm::Script => {
            let no_arguments = Arguments::Values(SmallVec::new());
            super::emit_call(lowering, closure, None, no_arguments, CallSite::default())
        }
    };
    lowering.builder.write_variable(result, evaluated);
    lowering.jump(join);

    lowering.continue_in(differs);
    let ordinary = emit_ordinary(lowering, call, is_construct, other_callee, arguments);
    lowering.builder.write_variable(result, ordinary);
    lowering.jump(join);

    lowering.continue_in(join);
    lowering.builder.read_variable(result)
}

fn lower_site_callee(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    site: Call,
    is_construct: bool,
    exit: Option<BlockId>,
) -> Callee {
    if is_construct {
        return Callee {
            function: expression::lower_expression(lowering, site.callee),
            this: None,
            key: None,
            name: find_callee_name(lowering.file, site.callee),
        };
    }
    let mut callee = super::lower_callee(lowering, site.callee, exit);
    match site.chain {
        Chain::Start => {
            let exit = exit.expect("an optional call has the exit of its chain");
            callee.function = condition::branch_if_expression_nullish(
                lowering,
                site.callee,
                callee.function,
                exit,
            );
        }
        Chain::No | Chain::Continue => {}
    }
    callee
}

fn emit_ordinary(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
    is_construct: bool,
    callee: Callee,
    arguments: Arguments,
) -> ValueId {
    if is_construct {
        super::emit_new_expression(lowering, call, callee, arguments)
    } else {
        super::emit_call_expression(lowering, call, callee, arguments, Tail::No)
    }
}
