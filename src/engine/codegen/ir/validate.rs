//! Checks that a function is well formed.

use bun_engine_asm::{Bank, Reg, Size};

use super::effects::EffectFlags;
use super::entities::{Block, Entity, Patchpoint, Value};
use super::function::Function;
use super::op::{AccessFlags, Binary, Load, Op, Store, Type, Unary};
use super::patchpoint::{Action, Boundary, Input, Output, PatchpointFlags};
use crate::analysis::{Cfg, Dominators};
use crate::bitset::BitSet;

macro_rules! require {
    ($condition:expr, $subject:expr) => {
        if !$condition {
            return Err(format!("{:?}: {}", $subject, stringify!($condition)));
        }
    };
}

type Checked = Result<(), String>;

pub fn validate(function: &Function) -> Checked {
    let cfg = Cfg::new(function);
    let dominators = Dominators::new(function, &cfg);
    require!(!function.entries().is_empty(), "function");
    for &entry in function.entries() {
        require!(cfg.predecessors(entry.block).is_empty(), entry.block);
        require!(
            function.params(entry.block).len() == function.entry_params(entry).len(),
            entry.block
        );
        for (&param, &boundary) in function
            .params(entry.block)
            .iter()
            .zip(function.entry_params(entry))
        {
            require!(
                fits_boundary(function, function.type_of(param), boundary),
                param
            );
        }
    }
    let mut defined = BitSet::with_size(function.value_count());
    for &block in cfg.order() {
        require!(!function.is_removed(block), block);
        for (position, &param) in function.params(block).iter().enumerate() {
            require!(*function.op(param) == Op::Param(position as u32), param);
            require!(
                function.block_of(param) == block && function.type_of(param).is_data(),
                param
            );
            require!(defined.insert(param.index()), param);
        }
        require!(function.is_terminated(block), block);
        let mut previous = Value::NONE;
        for value in function.instructions(block) {
            require!(
                function.block_of(value) == block && function.previous(value) == previous,
                value
            );
            require!(
                function.effects(value).has(EffectFlags::ENDS_BLOCK)
                    == (value == function.last(block)),
                value
            );
            let mut result = Ok(());
            require!(!function.operands(value).contains(&value), value);
            require!(
                !function.state(function.state_of(value)).contains(&value),
                value
            );
            // The edges that leave a patchpoint may pass on its result.
            require!(defined.insert(value.index()), value);
            function.for_each_use(value, |used| {
                if result.is_ok() {
                    result = check_use(function, &dominators, &defined, block, value, used);
                }
            });
            result?;
            check_types(function, value)?;
            previous = value;
        }
        check_edges(function, block)?;
    }
    Ok(())
}

fn check_use(
    function: &Function,
    dominators: &Dominators,
    defined: &BitSet,
    block: Block,
    user: Value,
    used: Value,
) -> Checked {
    let pair = (user, used);
    require!(function.is_valid_value(used), pair);
    require!(
        !matches!(function.op(used), Op::Alias(_) | Op::Removed),
        pair
    );
    require!(function.type_of(used) != Type::Void, pair);
    require!(
        (function.type_of(used) == Type::Tuple) == matches!(function.op(user), Op::Extract(..)),
        pair
    );
    if !function.op(used).is_floating() {
        require!(
            defined.contains(used.index()) && dominators.dominates(function.block_of(used), block),
            pair
        );
    }
    Ok(())
}

fn check_edges(function: &Function, block: Block) -> Checked {
    let count = function.successors(block).len();
    match *function.op(function.last(block)) {
        Op::Jump => require!(count == 1, block),
        Op::Branch(_) => require!(count == 2, block),
        Op::Switch(value, cases) => {
            let mut keys = function.cases(cases).to_vec();
            require!(count == keys.len() + 1, block);
            require!(
                function.type_of(value) == Type::I64
                    || keys.iter().all(|&key| i32::try_from(key).is_ok()),
                block
            );
            keys.sort_unstable();
            keys.dedup();
            require!(count == keys.len() + 1, block);
        }
        Op::JumpTable(_, cases) => {
            require!(
                function
                    .cases(cases)
                    .iter()
                    .all(|&position| (0..count as i64).contains(&position)),
                block
            );
        }
        Op::Return(_) | Op::Unreachable => require!(count == 0, block),
        _ => {}
    }
    for edge in function.successors(block) {
        require!(function.source(edge) == block, edge);
        let (args, params) = (function.args(edge), function.params(function.target(edge)));
        require!(args.len() == params.len(), edge);
        require!(
            args.iter()
                .zip(params)
                .all(|(&arg, &param)| function.type_of(arg) == function.type_of(param)),
            edge
        );
    }
    Ok(())
}

fn fits_register(function: &Function, ty: Type, reg: Reg) -> bool {
    (reg.bank() == Bank::Gpr) == ty.is_int() && !function.pinned.contains(reg)
}

fn fits_boundary(function: &Function, ty: Type, boundary: Boundary) -> bool {
    match boundary {
        Boundary::Register(reg) => fits_register(function, ty, reg),
        Boundary::Frame(offset) => offset % ty.bytes().min(8) as i32 == 0,
    }
}

fn unary_fits(op: Unary, from: Type, to: Type) -> bool {
    use Type::{F32, F64, I32, I64};
    match op {
        Unary::Neg => from == to && (from.is_int() || from.is_float()),
        Unary::CountLeadingZeros | Unary::CountTrailingZeros | Unary::CountOnes => {
            from == to && from.is_int()
        }
        Unary::SwapBytes(size) => {
            from == to && from.is_int() && size != Size::S8 && size <= from.width().size()
        }
        Unary::SignExtend(size) => from == to && from.is_int() && size < Size::S32,
        Unary::Widen(_) => (from, to) == (I32, I64),
        Unary::Wrap => (from, to) == (I64, I32),
        Unary::Abs | Unary::Sqrt | Unary::Round(_) => from == to && from.is_float(),
        Unary::Promote => (from, to) == (F32, F64),
        Unary::Demote => (from, to) == (F64, F32),
        Unary::IntToFloat(_) => from.is_int() && to.is_float(),
        Unary::FloatToInt(_) | Unary::FloatToIntSaturating(_) => from.is_float() && to.is_int(),
        Unary::FloatToInt32Modular | Unary::FloatToHalfBits => (from, to) == (F64, I32),
        Unary::HalfBitsToFloat => (from, to) == (I32, F64),
        Unary::Bitcast => matches!(
            (from, to),
            (I32, F32) | (F32, I32) | (I64, F64) | (F64, I64)
        ),
        Unary::CanonicalizeNan => (from, to) == (F64, F64),
        Unary::Opaque => from == to,
        Unary::FitsIn(count) => from == to && from.is_int() && count < from.width().bits(),
    }
}

fn binary_fits(op: Binary, ty: Type) -> bool {
    match op {
        Binary::Add
        | Binary::Sub
        | Binary::Mul
        | Binary::Div
        | Binary::And
        | Binary::Or
        | Binary::Xor => ty.is_int() || ty.is_float(),
        Binary::Min | Binary::Max | Binary::CopySign => ty.is_float(),
        _ => ty.is_int(),
    }
}

fn check_types(function: &Function, value: Value) -> Checked {
    use Type::{I32, I64, Tuple, V128, Void};
    let ty = function.type_of(value);
    let of = |operand: Value| function.type_of(operand);
    let all = |operands: &[Value], expected: Type| {
        operands.iter().all(|&operand| of(operand) == expected)
    };
    let holds = |size: Size, ty: Type| ty.is_int() && size <= ty.width().size();
    if let Some(access) = function.op(value).access() {
        let is_load = matches!(function.op(value), Op::Load { .. } | Op::LoadLane { .. });
        require!(access.heap().index() < function.heap_count(), value);
        require!(
            is_load || !access.has(AccessFlags::IMMUTABLE | AccessFlags::ALWAYS_READABLE),
            value
        );
        require!(
            !access
                .flags()
                .contains(AccessFlags::TRAPS | AccessFlags::ALWAYS_READABLE),
            value
        );
        require!(of(*function.operands(value).last().unwrap()) == I64, value);
        let data = if is_load {
            ty
        } else {
            of(function.operands(value)[0])
        };
        require!(!access.has(AccessFlags::ATOMIC) || data.is_int(), value);
    }
    let fits = match *function.op(value) {
        Op::Unary(op, operand) => unary_fits(op, of(operand), ty),
        Op::Binary(op, [lhs, rhs]) => {
            binary_fits(op, ty) && of(lhs) == ty && of(rhs) == if op.is_shift() { I32 } else { ty }
        }
        Op::Compare(_, [lhs, rhs]) => ty == I32 && of(lhs).is_int() && of(lhs) == of(rhs),
        Op::FloatCompare(_, [lhs, rhs]) => ty == I32 && of(lhs).is_float() && of(lhs) == of(rhs),
        Op::Select([condition, then, or]) => of(condition).is_int() && all(&[then, or], ty),
        Op::Wide(_, args) => ty == Tuple && all(&args, I64),
        Op::MulWide(_, args) => ty == Tuple && all(&args, I64),
        Op::Extract(tuple, position) => function.tuple_element_type(tuple, position) == Some(ty),
        Op::Load { kind, .. } => match kind {
            Load::Narrow(size, _) => ty == I32 && size < Size::S32,
            Load::Full => ty.is_data(),
            Load::VectorExtend(size, _) => ty == V128 && size < Size::S64,
            Load::VectorSplat(_) => ty == V128,
            Load::VectorZero(size) => ty == V128 && size >= Size::S32,
        },
        Op::Store {
            kind,
            args: [stored, _],
            ..
        } => {
            ty == Void
                && !matches!(kind, Store::Narrow(size) if !of(stored).is_int() || size >= of(stored).width().size())
        }
        Op::LoadLane {
            lanes,
            lane,
            args: [vector, _],
            ..
        } => ty == V128 && of(vector) == V128 && lane < 16 / lanes.bytes(),
        Op::StoreLane {
            lanes,
            lane,
            args: [vector, _],
            ..
        } => ty == Void && of(vector) == V128 && lane < 16 / lanes.bytes(),
        Op::AtomicUpdate {
            size,
            args: [operand, _],
            access,
            ..
        } => holds(size, ty) && of(operand) == ty && access.has(AccessFlags::ATOMIC),
        Op::AtomicCompareExchange {
            size,
            args: [expected, replacement, _],
            access,
        } => {
            holds(size, ty) && all(&[expected, replacement], ty) && access.has(AccessFlags::ATOMIC)
        }
        Op::Check(condition, _) | Op::Branch(condition) | Op::Switch(condition, _) => {
            ty == Void && of(condition).is_int()
        }
        Op::Checked(_, args, _) => ty.is_int() && all(&args, ty),
        Op::Patchpoint(patchpoint) => return check_patchpoint(function, value, patchpoint),
        Op::VectorUnary(_, operand) => ty == V128 && of(operand) == V128,
        Op::VectorBinary(_, args) | Op::Shuffle(args, _) => ty == V128 && all(&args, V128),
        Op::VectorTernary(_, args) => ty == V128 && all(&args, V128),
        Op::VectorShift(_, [vector, amount]) => {
            ty == V128 && of(vector) == V128 && of(amount) == I32
        }
        Op::VectorReduce(_, vector) => ty == I32 && of(vector) == V128,
        Op::Splat(lanes, scalar) => ty == V128 && of(scalar) == lanes.scalar(),
        Op::ExtractLane {
            lanes,
            lane,
            vector,
            ..
        } => ty == lanes.scalar() && of(vector) == V128 && lane < lanes.count(),
        Op::ReplaceLane {
            lanes,
            lane,
            args: [vector, scalar],
        } => {
            ty == V128 && of(vector) == V128 && of(scalar) == lanes.scalar() && lane < lanes.count()
        }
        Op::GetVariable(variable) => ty == function.variable_type(variable),
        Op::SetVariable(variable, stored) => {
            ty == Void && of(stored) == function.variable_type(variable)
        }
        Op::JumpTable(index, _) => ty == Void && of(index) == I32,
        Op::Return(_) => {
            let (values, results) = (function.operands(value), function.results());
            values.len() == results.len()
                && values
                    .iter()
                    .zip(results)
                    .all(|(&result, &boundary)| fits_boundary(function, of(result), boundary))
        }
        Op::Fence { .. } | Op::Jump | Op::Unreachable => ty == Void,
        Op::Node { kind, .. } | Op::WideNode { kind, .. } => {
            (ty == Tuple) == !function.node_info(kind).elements.is_empty()
        }
        Op::Const32(_)
        | Op::Const64(_)
        | Op::ConstF32(_)
        | Op::ConstF64(_)
        | Op::ConstV128(_)
        | Op::Pinned(_)
        | Op::SlotAddress(_)
        | Op::Displaced(..)
        | Op::Param(_)
        | Op::Alias(_)
        | Op::Removed => false,
    };
    require!(fits, (value, function.op(value)));
    Ok(())
}

fn check_patchpoint(function: &Function, value: Value, patchpoint: Patchpoint) -> Checked {
    let data = function.patchpoint(patchpoint);
    let (operands, inputs, outputs) = (
        function.operands(value),
        function.inputs(patchpoint),
        function.outputs(patchpoint),
    );
    let expected = match outputs {
        [] => Type::Void,
        [(ty, _)] => *ty,
        _ => Type::Tuple,
    };
    require!(function.type_of(value) == expected, value);
    let has_results_in_memory = outputs
        .iter()
        .any(|(_, output)| matches!(output, Output::Outgoing(_)));
    require!(
        !has_results_in_memory || !data.effects.has(EffectFlags::ENDS_BLOCK),
        value
    );
    require!(
        ((data.clobbers_early | data.clobbers_late) & function.pinned).is_empty(),
        value
    );
    let jumps_to_successors =
        data.action == Action::Custom && data.effects.has(EffectFlags::ENDS_BLOCK);
    let needs_code_after =
        PatchpointFlags::UNEXTENDED_RESULTS | PatchpointFlags::MOVES_STACK_POINTER;
    let has_successors = function.successors(function.block_of(value)).len() != 0;
    require!(
        !(jumps_to_successors && has_successors && data.flags.intersects(needs_code_after)),
        value
    );
    if data.action == Action::CallIndirect {
        require!(
            matches!(
                inputs.first(),
                Some(Input::Anywhere | Input::Register | Input::Fixed(_))
            ),
            value
        );
        require!(function.type_of(operands[0]) == Type::I64, value);
    }
    let mut taken = bun_engine_asm::RegisterSet::EMPTY;
    for (&operand, &input) in operands.iter().zip(inputs) {
        match input {
            Input::Fixed(reg) | Input::LateFixed(reg) => {
                require!(
                    fits_register(function, function.type_of(operand), reg),
                    value
                );
                require!(
                    !taken.contains(reg) && !data.clobbers_early.contains(reg),
                    value
                );
                require!(
                    input == Input::Fixed(reg) || !data.clobbers_late.contains(reg),
                    value
                );
                taken.insert(reg);
            }
            Input::Outgoing(offset) => require!(offset >= 0 && offset % 4 == 0, value),
            _ => {}
        }
    }
    taken = bun_engine_asm::RegisterSet::EMPTY;
    for &(ty, output) in outputs {
        require!(ty.is_data(), value);
        match output {
            Output::Fixed(reg) => {
                require!(
                    fits_register(function, ty, reg) && !taken.contains(reg),
                    value
                );
                require!(!inputs.contains(&Input::LateFixed(reg)), value);
                taken.insert(reg);
            }
            Output::Outgoing(offset) => require!(offset >= 0 && offset % 8 == 0, value),
            Output::Register | Output::EarlyRegister => {}
        }
    }
    Ok(())
}
