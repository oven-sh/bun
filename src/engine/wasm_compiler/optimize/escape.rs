//! Replaces the objects that nothing but their fields is seen of with variables.

use bun_engine_asm::{Sign, Size};
use bun_engine_codegen::ir::{
    Binary, Block, Builder, Entity, Function, Heap, Load, Op, Table, Unary, Value, Variable,
};

use super::map::Map;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Fate {
    NoObject,
    Escapes,
    Dissolves,
}

#[derive(Default)]
pub(super) struct Escapes {
    /// All their fields are stored right after they are made.
    objects: Vec<Value>,
    /// Instructions that only the collector needs, and the object that they are for.
    servants: Vec<(Value, Value)>,
    fates: Table<Value, Fate>,
    accesses: Vec<Value>,
    fields: Map<Variable>,
}

impl Escapes {
    pub(super) fn clear(&mut self) {
        self.objects.clear();
        self.servants.clear();
    }

    pub(super) fn watch(&mut self, object: Option<Value>) {
        self.objects.extend(object);
    }

    pub(super) fn note_servant(&mut self, servant: Value, object: Value) {
        if !self.objects.is_empty() {
            self.servants.push((servant, object));
        }
    }

    /// There are no aliases.
    pub(super) fn dissolve(&mut self, function: &mut Function) {
        if self.objects.is_empty() {
            return;
        }
        self.fates.refill(function.value_count(), Fate::NoObject);
        for &object in &self.objects {
            self.fates[object] = Fate::Dissolves;
        }
        self.find_escapes(function);
        self.fields.clear();
        for &access in &self.accesses {
            let (Op::Load {
                address, offset, ..
            }
            | Op::Store {
                args: [_, address],
                offset,
                ..
            }) = *function.op(access)
            else {
                unreachable!("not an access")
            };
            if self.fates[address] == Fate::Dissolves {
                let key = (address.index() as u64) << 32 | u64::from(offset as u32);
                let ty = match *function.op(access) {
                    Op::Store { args, .. } => function.type_of(args[0]),
                    _ => function.type_of(access),
                };
                let field = (self.fields).get_or_insert_with(key, || function.add_variable(ty));
                replace_access(function, access, field);
            }
        }
        let objects = self.objects.iter().map(|&object| (object, object));
        for (value, object) in self.servants.iter().copied().chain(objects) {
            let object = function.resolve(object);
            if self.fates[object] == Fate::Dissolves && *function.op(value) != Op::Removed {
                function.remove(value);
            }
        }
    }

    fn find_escapes(&mut self, function: &Function) {
        self.accesses.clear();
        // They were made in this order.
        let is_servant = |value| (self.servants.binary_search_by_key(&value, |it| it.0)).is_ok();
        for block in (0..function.block_count()).map(Block::from_index) {
            for value in function.instructions(block) {
                let operands = function.operands(value);
                let seen = match function.op(value) {
                    // The others read the header.
                    Op::Load { access, .. } | Op::Store { access, .. }
                        if access.heap() != Heap::NOTHING =>
                    {
                        let (&address, stored) = operands.split_last().expect("an address");
                        if self.fates[address] == Fate::Dissolves {
                            self.accesses.push(value);
                        }
                        stored
                    }
                    Op::Patchpoint(_) if is_servant(value) => &[],
                    _ => operands,
                };
                let args = (function.successors(block))
                    .filter(|_| value == function.last(block))
                    .flat_map(|edge| function.args(edge));
                for &operand in seen.iter().chain(args) {
                    if self.fates[operand] == Fate::Dissolves {
                        self.fates[operand] = Fate::Escapes;
                    }
                }
            }
        }
    }
}

/// The variable has the bits of a packed field in its low end.
fn replace_access(function: &mut Function, access: Value, field: Variable) {
    match *function.op(access) {
        Op::Store { args, .. } => *function.op_mut(access) = Op::SetVariable(field, args[0]),
        Op::Load {
            kind: Load::Narrow(size, sign),
            ..
        } => {
            let mut builder = Builder::before(function, access);
            let bits = builder.get(field);
            let mask = builder.const32(if size == Size::S8 { 0xff } else { 0xffff });
            *function.op_mut(access) = match sign {
                Sign::Signed => Op::Unary(Unary::SignExtend(size), bits),
                Sign::Unsigned => Op::Binary(Binary::And, [bits, mask]),
            };
        }
        _ => *function.op_mut(access) = Op::GetVariable(field),
    }
}
