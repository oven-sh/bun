use core::fmt;

use super::entities::{Block, Value};
use super::function::Function;
use super::op::{Op, Type};

struct Name<'a>(&'a Function, Value);

impl fmt::Debug for Name<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let Self(function, value) = *self;
        if !function.is_valid_value(value) {
            return write!(f, "{value:?}?");
        }
        match *function.op(value) {
            Op::Const32(constant) => write!(f, "{constant}i32"),
            Op::Const64(constant) => write!(f, "{:#x}i64", constant.get()),
            Op::ConstF32(bits) => write!(f, "{:?}f32/{bits:#x}", f32::from_bits(bits)),
            Op::ConstF64(bits) => write!(f, "{:?}f64/{bits:?}", f64::from_bits(bits.get())),
            Op::ConstV128(constant) => {
                write!(f, "{:#034x}v128", function.vector_constant(constant))
            }
            Op::Pinned(register) => write!(f, "{register:?}"),
            Op::SlotAddress(slot) => write!(f, "&{slot:?}"),
            Op::Displaced(reg, offset) => write!(f, "{reg:?}{offset:+}"),
            _ => write!(f, "{value:?}"),
        }
    }
}

impl Function {
    fn write_values(&self, f: &mut fmt::Formatter<'_>, values: &[Value]) -> fmt::Result {
        f.debug_list()
            .entries(values.iter().map(|&value| Name(self, value)))
            .finish()
    }

    fn write_instruction(&self, f: &mut fmt::Formatter<'_>, value: Value) -> fmt::Result {
        write!(f, "    ")?;
        if self.type_of(value) != Type::Void {
            write!(f, "{value:?}: {:?} = ", self.type_of(value))?;
        }
        match *self.op(value) {
            Op::Unary(op, _) => write!(f, "{op:?}"),
            Op::Binary(op, _) => write!(f, "{op:?}"),
            Op::Compare(cond, _) => write!(f, "Compare {cond:?}"),
            Op::FloatCompare(cond, _) => write!(f, "FloatCompare {cond:?}"),
            Op::Select(_) => write!(f, "Select"),
            Op::Load {
                kind,
                offset,
                access,
                ..
            } => write!(f, "Load {kind:?} +{offset} {access:?}"),
            Op::Store {
                kind,
                offset,
                access,
                ..
            } => write!(f, "Store {kind:?} +{offset} {access:?}"),
            Op::Check(_, exit) => write!(f, "Check #{}", exit.token.0),
            Op::Checked(op, _, exit) => write!(f, "Checked {op:?} #{}", exit.token.0),
            Op::Patchpoint(patchpoint) => {
                let data = self.patchpoint(patchpoint);
                write!(
                    f,
                    "Patchpoint {:?} #{} {:?}",
                    data.action, data.token.0, data.effects
                )?;
                write!(
                    f,
                    " {:?} -> {:?}",
                    self.inputs(patchpoint),
                    self.outputs(patchpoint)
                )?;
                write!(
                    f,
                    " clobbers {:?} {:?}",
                    data.clobbers_early, data.clobbers_late
                )
            }
            Op::Shuffle(_, lanes) => {
                write!(f, "Shuffle {:?}", self.vector_constant(lanes).to_le_bytes())
            }
            Op::Switch(_, cases) => write!(f, "Switch {:?}", self.cases(cases)),
            Op::JumpTable(_, cases) => write!(f, "JumpTable {:?}", self.cases(cases)),
            Op::Node { kind, data, .. } | Op::WideNode { kind, data, .. } => {
                write!(f, "{} #{data}", self.node_info(kind).name)
            }
            Op::Branch(_) => write!(f, "Branch"),
            Op::Return(_) => write!(f, "Return"),
            op => write!(f, "{op:?}"),
        }?;
        if !self.operands(value).is_empty() {
            write!(f, " ")?;
            self.write_values(f, self.operands(value))?;
        }
        if let Some(state) = self.state_of(value).expand() {
            write!(f, " {state:?} ")?;
            self.write_values(f, self.state(state))?;
        }
        writeln!(f)
    }

    fn write_block(&self, f: &mut fmt::Formatter<'_>, block: Block) -> fmt::Result {
        write!(f, "{block:?}(")?;
        for (position, &param) in self.params(block).iter().enumerate() {
            write!(
                f,
                "{}{param:?}: {:?}",
                if position == 0 { "" } else { ", " },
                self.type_of(param)
            )?;
        }
        write!(f, "):")?;
        if let Some(&entry) = self.entries().iter().find(|entry| entry.block == block) {
            write!(f, " entry {:?}", self.entry_params(entry))?;
        }
        writeln!(f)?;
        self.instructions(block)
            .try_for_each(|value| self.write_instruction(f, value))?;
        for edge in self.successors(block) {
            write!(f, "        -> {:?}", self.target(edge))?;
            self.write_values(f, self.args(edge))?;
            writeln!(f, "{}", if self.is_rare(edge) { " rare" } else { "" })?;
        }
        Ok(())
    }
}

impl fmt::Debug for Function {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.blocks()
            .try_for_each(|block| self.write_block(f, block))
    }
}
