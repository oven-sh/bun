//! Values with and without tags are not mixed up, and what is loaded from has been looked at.

use bun_engine_codegen::analysis::Cfg;
use bun_engine_codegen::ir::{AccessFlags, Entity, Op, Type, Unary, Value as Ssa};
use bun_engine_vm::SpeculatedType as T;

use super::{Checked, about};
use crate::graph::heaps::holds_values;
use crate::graph::{Format, Gives, Graph, Kind};

/// Of an I64.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Form {
    Tagged,
    Int52,
    Word,
    /// The instruction does not tell.
    Any,
}

fn form_of(graph: &Graph, value: Ssa) -> Form {
    let value = graph.root(value);
    match graph.kind(value).map(Kind::gives) {
        Some(Gives::Value(_)) => Form::Tagged,
        Some(Gives::Int52) => Form::Int52,
        Some(_) => Form::Word,
        None => match (graph.function.op(value), graph.inherent_type(value)) {
            (Op::Param(_), T::INT52) => Form::Int52,
            (Op::Param(_), _) => Form::Tagged,
            (Op::Unary(op, _), _) if *op != Unary::Opaque => Form::Word,
            _ => Form::Any,
        },
    }
}

fn require_tagged(graph: &Graph, value: Ssa) -> Checked {
    let form = form_of(graph, value);
    if graph.function.type_of(value) == Type::I64 && matches!(form, Form::Tagged | Form::Any) {
        return Ok(());
    }
    Err(format!("takes v{} to have a tag", value.index()))
}

fn require_untagged(graph: &Graph, value: Ssa, ty: Type) -> Checked {
    if graph.function.type_of(value) == ty && form_of(graph, value) != Form::Tagged
        || ty != Type::I64 && graph.function.type_of(value) == ty
    {
        return Ok(());
    }
    Err(format!("takes v{} for an {ty:?}", value.index()))
}

fn check_node(graph: &Graph, kind: Kind, operands: &[Ssa]) -> Checked {
    match kind {
        Kind::BoxInt32 | Kind::BoxBoolean | Kind::UInt32ToNumber => {
            require_untagged(graph, operands[0], Type::I32)
        }
        Kind::BoxInt52 => require_untagged(graph, operands[0], Type::I64),
        Kind::BoxDouble => require_untagged(graph, operands[0], Type::F64),
        Kind::CheckType
        | Kind::CheckShape
        | Kind::CheckModes
        | Kind::HasModes
        | Kind::IsType
        | Kind::StoreBarrier
        | Kind::KeepAlive
        | Kind::AsInt32
        | Kind::AsInt52
        | Kind::AsDouble
        | Kind::AsBoolean
        | Kind::NumberToDouble
        | Kind::PrimitiveToDouble
        | Kind::Call
        | Kind::Construct
        | Kind::TailCall
        | Kind::DirectCall
        | Kind::DirectConstruct
        | Kind::DirectTailCall => (operands.iter()).try_for_each(|&it| require_tagged(graph, it)),
        _ => Ok(()),
    }
}

fn check_instruction(graph: &Graph, value: Ssa) -> Checked {
    let function = &graph.function;
    let state = function.state_of(value);
    let tags = state.expand().map_or_default(|it| function.state_tags(it));
    for (&held, &tag) in function.state(state).iter().zip(tags) {
        match Format::from_tag(tag) {
            Format::Tagged => require_tagged(graph, held)?,
            format => require_untagged(graph, held, format.machine_type())?,
        }
    }
    match *function.op(value) {
        Op::Store { args, access, .. } if holds_values(function, access.heap()) => {
            require_tagged(graph, args[0])
        }
        Op::Load {
            address, access, ..
        } if access.has(AccessFlags::ALWAYS_READABLE)
            && graph.is_specialized
            && graph.is_loose(address, access.heap()) =>
        {
            Err(format!("does not wait for a check of v{}", address.index()))
        }
        Op::Return(_) => require_tagged(graph, function.operands(value)[0]),
        _ => (graph.kind(value)).map_or(Ok(()), |kind| {
            check_node(graph, kind, function.operands(value))
        }),
    }
}

pub(super) fn validate(graph: &Graph, cfg: &Cfg) -> Checked {
    let function = &graph.function;
    for &block in cfg.order() {
        for value in function.instructions(block) {
            about(graph, value, check_instruction(graph, value))?;
        }
        for edge in function.successors(block) {
            let params = function.params(function.target(edge));
            for (&arg, &param) in function.args(edge).iter().zip(params) {
                let checked = match (function.type_of(param), form_of(graph, param)) {
                    (Type::I64, Form::Tagged) => require_tagged(graph, arg),
                    (ty, _) => require_untagged(graph, arg, ty),
                };
                about(graph, param, checked)?;
            }
        }
    }
    Ok(())
}
