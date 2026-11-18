//! Adds instructions at a position, and folds the ones whose result is evident.

use bun_engine_asm::{
    AtomicOp, Cond, FloatCond, Sign, Size, VectorBinary, VectorReduce, VectorShift, VectorTernary,
    VectorUnary,
};

use super::effects::EffectFlags;
use super::entities::{Block, Heap, State, Value, Variable};
use super::evaluate;
use super::function::{Function, Successor};
use super::node::NodeKind;
use super::op::{Access, Binary, Checked, Exit, Lanes, Load, Op, Origin, Store, Type, Unary, Wide};
use super::patchpoint::{Input, Output, PatchpointData};

/// A value, or an integer that becomes a constant of the type that is wanted.
pub trait Operand: Copy {
    fn of_type(self, function: &mut Function, ty: Type) -> Value;
}

impl Operand for Value {
    #[inline]
    fn of_type(self, _: &mut Function, _: Type) -> Value {
        self
    }
}

macro_rules! integer_operands {
    ($($integer:ty),*) => {
        $(impl Operand for $integer {
            #[inline]
            fn of_type(self, function: &mut Function, ty: Type) -> Value {
                debug_assert!(ty.is_int());
                function.constant(ty, self as u64)
            }
        })*
    };
}

integer_operands!(i32, u32, i64, u64, usize);

pub struct Builder<'a> {
    pub function: &'a mut Function,
    pub origin: Origin,
    block: Block,
    /// `NONE` for the end of the block.
    before: Value,
}

impl core::ops::Deref for Builder<'_> {
    type Target = Function;

    #[inline]
    fn deref(&self) -> &Function {
        self.function
    }
}

impl core::ops::DerefMut for Builder<'_> {
    #[inline]
    fn deref_mut(&mut self) -> &mut Function {
        self.function
    }
}

macro_rules! binary_shorthands {
    ($($name:ident => $op:expr,)*) => {
        $(#[inline]
        pub fn $name(&mut self, lhs: Value, rhs: impl Operand) -> Value {
            self.binary($op, lhs, rhs)
        })*
    };
}

macro_rules! compare_shorthands {
    ($($name:ident => $cond:ident,)*) => {
        $(#[inline]
        pub fn $name(&mut self, lhs: Value, rhs: impl Operand) -> Value {
            self.compare(Cond::$cond, lhs, rhs)
        })*
    };
}

impl<'a> Builder<'a> {
    pub fn at_end(function: &'a mut Function, block: Block) -> Self {
        Self {
            function,
            origin: Origin::default(),
            block,
            before: Value::NONE,
        }
    }

    /// With the origin of `value`.
    pub fn before(function: &'a mut Function, value: Value) -> Self {
        Self {
            origin: function.origin(value),
            block: function.block_of(value),
            before: value,
            function,
        }
    }

    #[inline]
    pub fn switch_to(&mut self, block: Block) {
        (self.block, self.before) = (block, Value::NONE);
    }

    #[inline]
    pub fn block(&self) -> Block {
        self.block
    }

    /// Folds nothing.
    #[inline]
    pub fn insert(&mut self, op: Op, ty: Type) -> Value {
        if self.before.is_none() {
            self.function.append(self.block, op, ty, self.origin)
        } else {
            self.function
                .insert_before(self.before, op, ty, self.origin)
        }
    }

    pub fn boolean(&mut self, value: bool) -> Value {
        self.const32(value.into())
    }

    /// For the operations whose result has the type of the operand.
    pub fn unary(&mut self, op: Unary, operand: Value) -> Value {
        let ty = self.type_of(operand);
        self.convert(op, ty, operand)
    }

    pub fn convert(&mut self, op: Unary, to: Type, operand: Value) -> Value {
        if let Some(bits) = self.constant_bits(operand)
            && op != Unary::Opaque
            && let Some(result) = evaluate::unary(op, self.type_of(operand), to, bits)
        {
            return self.constant(to, result);
        }
        self.insert(Op::Unary(op, operand), to)
    }

    pub fn zero_extend(&mut self, operand: Value) -> Value {
        self.convert(Unary::Widen(Sign::Unsigned), Type::I64, operand)
    }

    pub fn sign_extend(&mut self, operand: Value) -> Value {
        self.convert(Unary::Widen(Sign::Signed), Type::I64, operand)
    }

    pub fn wrap(&mut self, operand: Value) -> Value {
        if let Op::Unary(Unary::Widen(_), narrow) = *self.op(operand) {
            return narrow;
        }
        self.convert(Unary::Wrap, Type::I32, operand)
    }

    pub fn bitcast(&mut self, operand: Value) -> Value {
        let to = match self.type_of(operand) {
            Type::I32 => Type::F32,
            Type::I64 => Type::F64,
            Type::F32 => Type::I32,
            Type::F64 => Type::I64,
            _ => unreachable!("not a scalar"),
        };
        self.convert(Unary::Bitcast, to, operand)
    }

    #[inline]
    pub fn binary(&mut self, op: Binary, lhs: Value, rhs: impl Operand) -> Value {
        let ty = self.type_of(lhs);
        let rhs = rhs.of_type(self.function, if op.is_shift() { Type::I32 } else { ty });
        self.binary_values(op, ty, lhs, rhs)
    }

    fn binary_values(&mut self, op: Binary, ty: Type, mut lhs: Value, mut rhs: Value) -> Value {
        if op.is_commutative() && self.op(lhs).is_constant() {
            core::mem::swap(&mut lhs, &mut rhs);
        }
        if let Some(b) = self.constant_bits(rhs) {
            if let Some(a) = self.constant_bits(lhs)
                && let Some(result) = evaluate::binary(op, ty, a, b)
            {
                return self.constant(ty, result);
            }
            let is_identity = match op {
                Binary::Add | Binary::Sub | Binary::Or | Binary::Xor => b == 0,
                Binary::Mul => b == 1,
                Binary::And => self.is_int_constant(rhs, -1),
                _ => op.is_shift() && b % u64::from(ty.width().bits()) == 0,
            };
            if is_identity && ty.is_int() {
                return lhs;
            }
        }
        self.insert(Op::Binary(op, [lhs, rhs]), ty)
    }

    binary_shorthands! {
        add => Binary::Add,
        sub => Binary::Sub,
        mul => Binary::Mul,
        and => Binary::And,
        or => Binary::Or,
        xor => Binary::Xor,
        shl => Binary::Shl,
        shr => Binary::Shr,
        sar => Binary::Sar,
    }

    #[inline]
    pub fn compare(&mut self, cond: Cond, lhs: Value, rhs: impl Operand) -> Value {
        let ty = self.type_of(lhs);
        let rhs = rhs.of_type(self.function, ty);
        self.compare_values(cond, ty, lhs, rhs)
    }

    fn compare_values(&mut self, cond: Cond, ty: Type, lhs: Value, rhs: Value) -> Value {
        match (self.constant_bits(lhs), self.constant_bits(rhs)) {
            (Some(a), Some(b)) => self.boolean(evaluate::compare(cond, ty, a, b)),
            (Some(_), None) => self.insert(Op::Compare(cond.commuted(), [rhs, lhs]), Type::I32),
            _ => self.insert(Op::Compare(cond, [lhs, rhs]), Type::I32),
        }
    }

    compare_shorthands! {
        equal => Eq,
        not_equal => Ne,
        less_than => Lt,
        less_or_equal => Le,
        greater_than => Gt,
        greater_or_equal => Ge,
        below => Below,
        below_or_equal => BelowEq,
        above => Above,
        above_or_equal => AboveEq,
    }

    pub fn is_zero(&mut self, operand: Value) -> Value {
        self.equal(operand, 0)
    }

    pub fn is_not_zero(&mut self, operand: Value) -> Value {
        self.not_equal(operand, 0)
    }

    pub fn float_compare(&mut self, cond: FloatCond, lhs: Value, rhs: Value) -> Value {
        if let (Some(a), Some(b)) = (self.constant_bits(lhs), self.constant_bits(rhs)) {
            let holds = evaluate::float_compare(cond, self.type_of(lhs), a, b);
            return self.boolean(holds);
        }
        self.insert(Op::FloatCompare(cond, [lhs, rhs]), Type::I32)
    }

    pub fn select(&mut self, condition: Value, then: Value, or: Value) -> Value {
        match self.int_constant(condition) {
            Some(0) => or,
            Some(_) => then,
            None if then == or => then,
            None => {
                let ty = self.type_of(then);
                self.insert(Op::Select([condition, then, or]), ty)
            }
        }
    }

    /// Pairs are `[low, high]`.
    pub fn wide(&mut self, op: Wide, lhs: [Value; 2], rhs: [Value; 2]) -> [Value; 2] {
        let tuple = self.insert(Op::Wide(op, [lhs[0], lhs[1], rhs[0], rhs[1]]), Type::Tuple);
        [0, 1].map(|position| self.extract(tuple, position))
    }

    pub fn mul_wide(&mut self, sign: Sign, lhs: Value, rhs: Value) -> [Value; 2] {
        let tuple = self.insert(Op::MulWide(sign, [lhs, rhs]), Type::Tuple);
        [0, 1].map(|position| self.extract(tuple, position))
    }

    pub fn extract(&mut self, tuple: Value, position: u32) -> Value {
        let ty = self
            .tuple_element_type(tuple, position)
            .expect("the tuple has the element");
        self.insert(Op::Extract(tuple, position), ty)
    }

    // Memory

    #[inline]
    pub fn load(
        &mut self,
        ty: Type,
        address: Value,
        offset: i32,
        access: impl Into<Access>,
    ) -> Value {
        self.insert(
            Op::Load {
                kind: Load::Full,
                address,
                offset,
                access: access.into(),
            },
            ty,
        )
    }

    /// One or two bytes, as an I32.
    #[inline]
    pub fn load_narrow(
        &mut self,
        size: Size,
        sign: Sign,
        address: Value,
        offset: i32,
        access: impl Into<Access>,
    ) -> Value {
        self.insert(
            Op::Load {
                kind: Load::Narrow(size, sign),
                address,
                offset,
                access: access.into(),
            },
            Type::I32,
        )
    }

    pub fn load_vector(
        &mut self,
        kind: Load,
        address: Value,
        offset: i32,
        access: impl Into<Access>,
    ) -> Value {
        self.insert(
            Op::Load {
                kind,
                address,
                offset,
                access: access.into(),
            },
            Type::V128,
        )
    }

    #[inline]
    pub fn store(&mut self, value: Value, address: Value, offset: i32, access: impl Into<Access>) {
        self.insert(
            Op::Store {
                kind: Store::Full,
                args: [value, address],
                offset,
                access: access.into(),
            },
            Type::Void,
        );
    }

    /// The low bytes of an integer.
    pub fn store_sized(
        &mut self,
        size: Size,
        value: Value,
        address: Value,
        offset: i32,
        access: impl Into<Access>,
    ) {
        let is_full = u32::from(size.bytes()) == self.type_of(value).bytes();
        let kind = if is_full {
            Store::Full
        } else {
            Store::Narrow(size)
        };
        self.insert(
            Op::Store {
                kind,
                args: [value, address],
                offset,
                access: access.into(),
            },
            Type::Void,
        );
    }

    pub fn atomic_update(
        &mut self,
        op: AtomicOp,
        size: Size,
        operand: Value,
        address: Value,
        access: Access,
    ) -> Value {
        let ty = self.type_of(operand);
        self.insert(
            Op::AtomicUpdate {
                op,
                size,
                args: [operand, address],
                access,
            },
            ty,
        )
    }

    pub fn atomic_compare_exchange(
        &mut self,
        size: Size,
        expected: Value,
        replacement: Value,
        address: Value,
        access: Access,
    ) -> Value {
        let ty = self.type_of(expected);
        self.insert(
            Op::AtomicCompareExchange {
                size,
                args: [expected, replacement, address],
                access,
            },
            ty,
        )
    }

    pub fn fence(&mut self, reads: Heap, writes: Heap) {
        self.insert(Op::Fence { reads, writes }, Type::Void);
    }

    // Exits and patchpoints

    /// Exits if `condition` is not zero.
    pub fn check(&mut self, condition: Value, exit: Exit) {
        if !self.is_int_constant(condition, 0) {
            self.insert(Op::Check(condition, exit), Type::Void);
        }
    }

    pub fn checked(&mut self, op: Checked, lhs: Value, rhs: impl Operand, exit: Exit) -> Value {
        let ty = self.type_of(lhs);
        let rhs = rhs.of_type(self.function, ty);
        if let (Some(a), Some(b)) = (self.constant_bits(lhs), self.constant_bits(rhs))
            && let Some(result) = evaluate::checked(op, ty, a, b)
        {
            return self.constant(ty, result);
        }
        self.insert(Op::Checked(op, [lhs, rhs], exit), ty)
    }

    /// Gives nothing, the one result, or a tuple.
    pub fn patchpoint(
        &mut self,
        data: &PatchpointData,
        operands: &[(Value, Input)],
        results: &[(Type, Output)],
    ) -> Value {
        let ty = match results {
            [] => Type::Void,
            [(ty, _)] => *ty,
            _ => Type::Tuple,
        };
        let patchpoint = self.add_patchpoint(data, operands, results);
        self.insert(Op::Patchpoint(patchpoint), ty)
    }

    /// The code goes to one of the successors or leaves the function. A call returns to the first successor, and an
    /// unwinder may resume at another. The results are in registers.
    pub fn terminal_patchpoint(
        &mut self,
        data: &PatchpointData,
        operands: &[(Value, Input)],
        results: &[(Type, Output)],
        successors: &[Successor<'_>],
    ) -> Value {
        let mut data = *data;
        data.effects.flags |= EffectFlags::ENDS_BLOCK;
        let value = self.patchpoint(&data, operands, results);
        self.function.set_successors(self.block, successors);
        value
    }

    #[inline]
    pub fn node(
        &mut self,
        kind: NodeKind,
        ty: Type,
        operands: &[Value],
        data: u32,
        state: State,
    ) -> Value {
        let op = self.node_op(kind, operands, data, state);
        self.insert(op, ty)
    }

    // Vectors

    pub fn vector_unary(&mut self, op: VectorUnary, operand: Value) -> Value {
        self.insert(Op::VectorUnary(op, operand), Type::V128)
    }

    pub fn vector_binary(&mut self, op: VectorBinary, lhs: Value, rhs: Value) -> Value {
        self.insert(Op::VectorBinary(op, [lhs, rhs]), Type::V128)
    }

    pub fn vector_ternary(&mut self, op: VectorTernary, operands: [Value; 3]) -> Value {
        self.insert(Op::VectorTernary(op, operands), Type::V128)
    }

    pub fn vector_shift(&mut self, op: VectorShift, vector: Value, amount: Value) -> Value {
        self.insert(Op::VectorShift(op, [vector, amount]), Type::V128)
    }

    pub fn vector_reduce(&mut self, op: VectorReduce, vector: Value) -> Value {
        self.insert(Op::VectorReduce(op, vector), Type::I32)
    }

    pub fn shuffle(&mut self, lhs: Value, rhs: Value, lanes: [u8; 16]) -> Value {
        let lanes = self.intern_vector(u128::from_le_bytes(lanes));
        self.insert(Op::Shuffle([lhs, rhs], lanes), Type::V128)
    }

    pub fn splat(&mut self, lanes: Lanes, scalar: Value) -> Value {
        self.insert(Op::Splat(lanes, scalar), Type::V128)
    }

    pub fn extract_lane(&mut self, lanes: Lanes, sign: Sign, vector: Value, lane: u8) -> Value {
        self.insert(
            Op::ExtractLane {
                lanes,
                sign,
                lane,
                vector,
            },
            lanes.scalar(),
        )
    }

    pub fn replace_lane(&mut self, lanes: Lanes, vector: Value, lane: u8, scalar: Value) -> Value {
        self.insert(
            Op::ReplaceLane {
                lanes,
                lane,
                args: [vector, scalar],
            },
            Type::V128,
        )
    }

    // Variables

    pub fn get(&mut self, variable: Variable) -> Value {
        let ty = self.variable_type(variable);
        self.insert(Op::GetVariable(variable), ty)
    }

    pub fn set(&mut self, variable: Variable, value: Value) {
        self.insert(Op::SetVariable(variable, value), Type::Void);
    }

    // Ends of blocks

    pub fn jump(&mut self, target: Block, args: &[Value]) {
        self.insert(Op::Jump, Type::Void);
        self.function
            .set_successors(self.block, &[Successor::new(target, args)]);
    }

    pub fn branch<'s>(
        &mut self,
        condition: Value,
        then: impl Into<Successor<'s>>,
        or: impl Into<Successor<'s>>,
    ) {
        let (then, or) = (then.into(), or.into());
        if let Some(constant) = self.int_constant(condition) {
            let taken = if constant != 0 { then } else { or };
            return self.jump(taken.target, taken.args);
        }
        self.branch_both_ways(condition, then, or);
    }

    /// Both ways stay, whether or not the condition is a constant, so that the caller keeps its edges.
    pub fn branch_both_ways<'s>(
        &mut self,
        condition: Value,
        then: impl Into<Successor<'s>>,
        or: impl Into<Successor<'s>>,
    ) {
        self.insert(Op::Branch(condition), Type::Void);
        self.function
            .set_successors(self.block, &[then.into(), or.into()]);
    }

    /// The keys differ. Those for an I32 have their sign extended.
    pub fn switch(&mut self, value: Value, cases: &[(i64, Successor<'_>)], default: Successor<'_>) {
        let keys = self.add_cases(cases.iter().map(|&(key, _)| key));
        self.insert(Op::Switch(value, keys), Type::Void);
        self.function.clear_successors(self.block);
        for &(_, successor) in cases {
            self.function.push_successor(self.block, successor);
        }
        self.function.push_successor(self.block, default);
    }

    /// Goes to `successors[table[index]]`. `index` is in range.
    pub fn jump_table(
        &mut self,
        index: Value,
        table: impl IntoIterator<Item = u32>,
        successors: &[Successor<'_>],
    ) {
        let table = self.add_cases(table.into_iter().map(i64::from));
        self.insert(Op::JumpTable(index, table), Type::Void);
        self.function.set_successors(self.block, successors);
    }

    pub fn ret(&mut self, values: &[Value]) {
        let values = self.add_values(values);
        self.insert(Op::Return(values), Type::Void);
        self.function.clear_successors(self.block);
    }

    pub fn unreachable(&mut self) {
        self.insert(Op::Unreachable, Type::Void);
        self.function.clear_successors(self.block);
    }
}
