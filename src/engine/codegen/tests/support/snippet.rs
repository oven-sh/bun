//! Small functions in the form of text.
//!
//! A snippet is a list of expressions, of which the last is returned if it has a value.
//!
//! - Parameters are `i`, `l`, `f`, `d` or `v` for the type and a digit. `vm`, which is 0x700012340000, and `tag` are
//!   pinned, and `slot` is the address of 64 bytes in the frame.
//! - A number has the type of the operand beside it, unless it ends with the letter of a type.
//! - Accesses take an address and an offset. `!` after the name makes them trap, and `^` atomic.
//! - `@` precedes the name of an operation on vectors.
//! - `(let name value)` names a value, `(var name value)` makes a variable, and `(set name value)` changes it.
//! - `(loop statements)` repeats while the last one is not zero, and `(when condition statements)` may skip them.
//! - `(call values)` calls a C function. `(enter values)` passes the values on the stack and keeps no register.

use std::collections::HashMap;

use bun_engine_asm::Sign::{Signed, Unsigned};
use bun_engine_asm::Size::{S8, S16, S32};
use bun_engine_asm::{
    AtomicOp, Cond, FloatCond, RegisterSet, Rounding, Size, VectorBinary, VectorReduce,
    VectorShift, VectorUnary,
};
use bun_engine_codegen::Target;
use bun_engine_codegen::ir::Type::{F32, F64, I32, I64, V128, Void};
use bun_engine_codegen::ir::{
    Access, AccessFlags, Action, Binary, Block, Boundary, Builder, Checked, Effects, Exit,
    Function, Heap, Input, Lanes, Load, Op, PatchpointData, Token, Type, Unary, Value, Variable,
    Wide,
};

use super::vocabulary::{NOT_CELL_MASK, NUMBER_TAG, registers, signature};

enum Node<'a> {
    Atom(&'a str),
    List(&'a str, Vec<Node<'a>>),
}

fn parse<'a>(tokens: &mut impl Iterator<Item = &'a str>) -> Option<Node<'a>> {
    match tokens.next()? {
        ")" => None,
        "(" => {
            let name = tokens.next()?;
            let operands = std::iter::from_fn(|| parse(tokens)).collect();
            Some(Node::List(name, operands))
        }
        atom => Some(Node::Atom(atom)),
    }
}

fn type_of_letter(letter: char) -> Option<Type> {
    let types = [('i', I32), ('l', I64), ('f', F32), ('d', F64), ('v', V128)];
    Some(types.iter().find(|known| known.0 == letter)?.1)
}

fn type_of_param(token: &str) -> Option<Type> {
    let [letter, b'0'..=b'9'] = *token.as_bytes() else {
        return None;
    };
    type_of_letter(letter.into())
}

fn is_number(node: &Node<'_>) -> bool {
    matches!(node, Node::Atom(atom) if atom.starts_with(|c: char| c == '-' || c.is_ascii_digit()))
}

fn named<T: Copy + std::fmt::Debug>(all: &[T], name: &str) -> Option<T> {
    let has_name = |item: &T| format!("{item:?}").eq_ignore_ascii_case(name);
    all.iter().copied().find(has_name)
}

fn binary(name: &str) -> Option<Binary> {
    use Binary::*;
    Some(match name {
        "udiv" => UnsignedDiv,
        "urem" => UnsignedRem,
        "tdiv" => TotalDiv,
        "trem" => TotalRem,
        "mulh" => MulHigh(Signed),
        "umulh" => MulHigh(Unsigned),
        "rotl" => RotateLeft,
        "rotr" => RotateRight,
        _ => {
            let plain = [
                Add, Sub, Mul, Div, Rem, And, Or, Xor, Shl, Shr, Sar, Min, Max, CopySign,
            ];
            return named(&plain, name);
        }
    })
}

/// And the type of the result, if it is not that of the operand.
fn unary(name: &str) -> Option<(Unary, Option<Type>)> {
    use Unary::*;
    Some(match name {
        "neg" => (Neg, None),
        "clz" => (CountLeadingZeros, None),
        "ctz" => (CountTrailingZeros, None),
        "popcnt" => (CountOnes, None),
        "bswap16" => (SwapBytes(S16), None),
        "bswap32" => (SwapBytes(S32), None),
        "sext8" => (SignExtend(S8), None),
        "sext16" => (SignExtend(S16), None),
        "sx" => (Widen(Signed), Some(I64)),
        "zx" => (Widen(Unsigned), Some(I64)),
        "wrap" => (Wrap, Some(I32)),
        "abs" => (Abs, None),
        "sqrt" => (Sqrt, None),
        "floor" => (Round(Rounding::Down), None),
        "ceil" => (Round(Rounding::Up), None),
        "trunc" => (Round(Rounding::TowardZero), None),
        "nearest" => (Round(Rounding::Nearest), None),
        "itod" => (IntToFloat(Signed), Some(F64)),
        "utod" => (IntToFloat(Unsigned), Some(F64)),
        "dtoi" => (FloatToInt(Signed), Some(I32)),
        "toint32" => (FloatToInt32Modular, Some(I32)),
        "canon" => (CanonicalizeNan, None),
        "opaque" => (Opaque, None),
        _ => return None,
    })
}

fn load(name: &str) -> Option<(Load, Type)> {
    Some(match name {
        "load8s" => (Load::Narrow(S8, Signed), I32),
        "load8u" => (Load::Narrow(S8, Unsigned), I32),
        "load16s" => (Load::Narrow(S16, Signed), I32),
        "load16u" => (Load::Narrow(S16, Unsigned), I32),
        "splat32" => (Load::VectorSplat(S32), V128),
        _ => {
            let letter = name.strip_prefix("load")?.chars().next()?;
            (Load::Full, type_of_letter(letter)?)
        }
    })
}

struct Reader<'a> {
    function: Function,
    block: Block,
    names: HashMap<&'a str, Value>,
    variables: HashMap<&'a str, Variable>,
    target: Target,
}

impl<'a> Reader<'a> {
    fn builder(&mut self) -> Builder<'_> {
        Builder::at_end(&mut self.function, self.block)
    }

    fn number(&mut self, text: &str, wanted: Type) -> Value {
        let is_hex = text.contains("0x");
        let suffix = text.chars().last().filter(|&c| !is_hex || c > 'f');
        let (text, ty) = match suffix.and_then(type_of_letter) {
            Some(ty) => (&text[..text.len() - 1], ty),
            None => (text, wanted),
        };
        match ty {
            V128 => self.function.const_v128(text.parse().unwrap()),
            F32 if !is_hex => self.function.const_f32(text.parse().unwrap()),
            F64 if !is_hex => self.function.const_f64(text.parse().unwrap()),
            _ => {
                let magnitude = text.trim_start_matches('-');
                let magnitude = match magnitude.strip_prefix("0x") {
                    Some(digits) => u64::from_str_radix(digits, 16).unwrap(),
                    None => magnitude.parse().unwrap(),
                };
                let is_negative = text.starts_with('-');
                let bits = magnitude.wrapping_mul(if is_negative { u64::MAX } else { 1 });
                self.function.constant(ty, bits)
            }
        }
    }

    /// In order, and of one type.
    fn alike<const N: usize>(&mut self, nodes: &[Node<'a>]) -> [Value; N] {
        let values: [_; N] = std::array::from_fn(|index| {
            (!is_number(&nodes[index])).then(|| self.value(&nodes[index], Void))
        });
        let known = values.iter().flatten().next();
        let ty = known.map_or(I32, |&value| self.function.type_of(value));
        std::array::from_fn(|index| values[index].unwrap_or_else(|| self.value(&nodes[index], ty)))
    }

    fn place(&mut self, nodes: &[Node<'a>]) -> (Value, i32) {
        let (address, offset) = (self.value(&nodes[0], I64), self.value(&nodes[1], I32));
        (address, self.function.int_constant(offset).unwrap() as i32)
    }

    fn exit(&mut self, state: &[Node<'a>]) -> Exit {
        let state: Vec<_> = state.iter().map(|node| self.value(node, I32)).collect();
        Exit {
            token: Token(0),
            state: self.function.add_state(&state),
        }
    }

    fn call(&mut self, is_native: bool, operands: &[Node<'a>]) -> Value {
        let registers = registers(self.target);
        let place = |(position, node): (usize, &Node<'a>)| {
            let input = if is_native {
                Input::Fixed(registers.argument_gprs[position].into())
            } else {
                Input::Outgoing(8 * position as i32)
            };
            (self.value(node, I64), input)
        };
        let args: Vec<_> = operands.iter().enumerate().map(place).collect();
        let action = Action::Call(bun_engine_asm::Target::Symbol(0));
        let mut data = PatchpointData::new(action, Token(0), Effects::CALL);
        let model = signature(self.target, if is_native { 1 } else { 6 });
        data.clobbers_late = model.clobbers;
        data.clobbers_upper_halves = model.clobbers_upper_halves;
        self.builder().patchpoint(&data, &args, &model.results)
    }

    fn end_with_branch(&mut self, condition: Value, then: Block) {
        let next = self.function.new_block();
        self.builder().branch(condition, then, next);
        self.block = next;
    }

    fn statement(&mut self, name: &str, operands: &[Node<'a>], access: Access) -> bool {
        match name {
            "let" | "var" | "set" => {
                let Node::Atom(defined) = operands[0] else {
                    panic!("not a name")
                };
                let value = self.value(&operands[1], I32);
                if name == "let" {
                    self.names.insert(defined, value);
                } else {
                    let (function, known) = (&mut self.function, self.variables.entry(defined));
                    let ty = function.type_of(value);
                    let variable = *known.or_insert_with(|| function.add_variable(ty));
                    self.builder().set(variable, value);
                }
            }
            "when" => {
                let (condition, after) = (self.value(&operands[0], I32), self.function.new_block());
                let body = self.function.new_block();
                self.builder().branch(condition, body, after);
                self.block = body;
                for node in &operands[1..] {
                    self.value(node, I32);
                }
                self.builder().jump(after, &[]);
                self.block = after;
            }
            "store" | "store8" | "store16" | "store32" => {
                let value = self.value(&operands[0], I32);
                let (address, offset) = self.place(&operands[1..]);
                match named(&[S8, S16, S32], &name.replace("tore", "")) {
                    Some(size) => {
                        self.builder()
                            .store_sized(size, value, address, offset, access);
                    }
                    None => self.builder().store(value, address, offset, access),
                }
            }
            "check" => {
                let (condition, exit) = (self.value(&operands[0], I32), self.exit(&operands[1..]));
                self.builder().check(condition, exit);
            }
            "branch" => {
                let (condition, away) = (self.value(&operands[0], I32), self.function.new_block());
                Builder::at_end(&mut self.function, away).unreachable();
                let next = self.function.new_block();
                self.builder().branch(condition, away.rare(), next);
                self.block = next;
            }
            "loop" => {
                let header = self.function.new_block();
                self.builder().jump(header, &[]);
                self.block = header;
                let values = operands.iter().map(|node| self.value(node, I32));
                let again = values.last().unwrap();
                self.end_with_branch(again, header);
            }
            "fence" | "storefence" | "loadfence" => {
                let heap = |unless| {
                    if name == unless {
                        Heap::NOTHING
                    } else {
                        Heap::EVERYTHING
                    }
                };
                self.builder().fence(heap("loadfence"), heap("storefence"));
            }
            _ => return false,
        }
        true
    }

    /// `NONE` for a statement.
    fn value(&mut self, node: &Node<'a>, wanted: Type) -> Value {
        let (name, operands) = match node {
            Node::Atom(text) if is_number(node) => return self.number(text, wanted),
            Node::Atom(name) => {
                return match self.variables.get(name) {
                    Some(&variable) => self.builder().get(variable),
                    None => self.names[name],
                };
            }
            Node::List(name @ ("call" | "enter"), operands) => {
                return self.call(*name == "call", operands);
            }
            Node::List(name, operands) => (*name, &operands[..]),
        };
        let mut flags = AccessFlags::empty();
        flags.set(AccessFlags::TRAPS, name.ends_with('!'));
        flags.set(AccessFlags::ATOMIC, name.ends_with('^'));
        let (name, access) = (
            name.trim_end_matches(['!', '^']),
            Access::new(Heap::EVERYTHING, flags),
        );
        if self.statement(name, operands, access) {
            return Value::NONE;
        }
        let (op, ty) = self.operation(name, operands, access);
        self.builder().insert(op, ty)
    }

    fn operation(&mut self, name: &str, operands: &[Node<'a>], access: Access) -> (Op, Type) {
        use AtomicOp::*;
        if let (Some(op), true) = (
            named(&[Add, Sub, And, Or, Xor, Exchange], name),
            access.has(AccessFlags::ATOMIC),
        ) {
            let args = [self.value(&operands[0], I32), self.value(&operands[1], I64)];
            let ty = self.function.type_of(args[0]);
            let size = ty.width().size();
            let update = Op::AtomicUpdate {
                op,
                size,
                args,
                access,
            };
            return (update, ty);
        }
        if let Some(op) = binary(name) {
            let args = if op.is_shift() {
                [self.value(&operands[0], I32), self.value(&operands[1], I32)]
            } else {
                self.alike(operands)
            };
            return (Op::Binary(op, args), self.function.type_of(args[0]));
        }
        if let Some((op, to)) = unary(name) {
            let operand = self.value(&operands[0], I32);
            let to = to.unwrap_or_else(|| self.function.type_of(operand));
            return (Op::Unary(op, operand), to);
        }
        if let Some((kind, ty)) = load(name) {
            let (address, offset) = self.place(operands);
            let load = Op::Load {
                kind,
                address,
                offset,
                access,
            };
            return (load, ty);
        }
        if let Some(cond) = named(&Cond::ALL, name) {
            return (Op::Compare(cond, self.alike(operands)), I32);
        }
        let after = |letter| name.strip_prefix(letter).unwrap_or_default();
        if let Some(op) = named(VectorBinary::ALL, after('@')) {
            return (Op::VectorBinary(op, self.alike(operands)), V128);
        }
        if let Some(op) = named(VectorUnary::ALL, after('@')) {
            return (Op::VectorUnary(op, self.value(&operands[0], V128)), V128);
        }
        if let Some(op) = named(VectorShift::ALL, after('@')) {
            let args = [V128, I32].map(|ty| self.value(&operands[usize::from(ty == I32)], ty));
            return (Op::VectorShift(op, args), V128);
        }
        if let Some(cond) = named(&FloatCond::ALL, after('f')) {
            return (Op::FloatCompare(cond, self.alike(operands)), I32);
        }
        if let Some(op) = named(&[Checked::Add, Checked::Sub, Checked::Mul], after('c')) {
            let (args, exit) = (self.alike(operands), self.exit(&operands[2..]));
            return (Op::Checked(op, args, exit), self.function.type_of(args[0]));
        }
        match name {
            "not" => {
                let operand = self.value(&operands[0], I32);
                let ty = self.function.type_of(operand);
                let ones = self.function.constant(ty, u64::MAX);
                (Op::Binary(Binary::Xor, [operand, ones]), ty)
            }
            "bitcast" => {
                let operand = self.value(&operands[0], I32);
                let pairs = [(I32, F32), (F32, I32), (I64, F64), (F64, I64)];
                let from = self.function.type_of(operand);
                let to = pairs.iter().find(|pair| pair.0 == from).unwrap().1;
                (Op::Unary(Unary::Bitcast, operand), to)
            }
            "select" => {
                let condition = self.value(&operands[0], I32);
                let [then, or] = self.alike(&operands[1..]);
                let ty = self.function.type_of(then);
                (Op::Select([condition, then, or]), ty)
            }
            "splat" => {
                let scalar = self.value(&operands[0], F32);
                let lanes = Lanes::Float(self.function.type_of(scalar).float_width());
                (Op::Splat(lanes, scalar), V128)
            }
            "anytrue" => {
                let vector = self.value(&operands[0], V128);
                (Op::VectorReduce(VectorReduce::AnyTrue, vector), I32)
            }
            "cas" => {
                let [expected, replacement] = self.alike(operands);
                let args = [expected, replacement, self.value(&operands[2], I64)];
                let ty = self.function.type_of(expected);
                let size: Size = ty.width().size();
                (Op::AtomicCompareExchange { size, args, access }, ty)
            }
            "wadd" | "wsub" => {
                let op = named(&[Wide::Add, Wide::Sub], after('w')).unwrap();
                (Op::Wide(op, self.alike(operands)), Type::Tuple)
            }
            "wmul" => (Op::MulWide(Unsigned, self.alike(operands)), Type::Tuple),
            "low" | "high" => {
                let tuple = self.value(&operands[0], I64);
                (Op::Extract(tuple, (name == "high").into()), I64)
            }
            _ => panic!("no operation is named {name}"),
        }
    }
}

/// Parameters and the result are where a C function has them.
pub(crate) fn function(text: &str, target: Target) -> Function {
    let registers = registers(target);
    let spaced = text.replace('(', " ( ").replace(')', " ) ");
    let mut params: Vec<&str> = spaced
        .split_whitespace()
        .filter(|token| type_of_param(token).is_some())
        .collect();
    params.sort_unstable_by_key(|name| (&name[1..], &name[..1]));
    params.dedup();
    let (mut gprs, mut fprs) = (
        registers.argument_gprs.iter(),
        registers.argument_fprs.iter(),
    );
    let places: Vec<_> = params
        .iter()
        .map(|name| {
            let ty = type_of_param(name).unwrap();
            let reg = if ty.is_int() {
                (*gprs.next().unwrap()).into()
            } else {
                (*fprs.next().unwrap()).into()
            };
            (ty, Boundary::Register(reg))
        })
        .collect();

    let mut function = Function::new(RegisterSet::of(&registers.pinned, &[]));
    let block = function.add_entry(&places);
    let values = function.params(block).to_vec();
    let mut names: HashMap<_, _> = params.into_iter().zip(values).collect();
    let held = [0x7000_1234_0000, NUMBER_TAG, NOT_CELL_MASK];
    for (reg, value) in registers.pinned.into_iter().zip(held) {
        function.set_pinned_value(reg, value);
    }
    names.insert("vm", function.pinned(registers.pinned[0]));
    names.insert("tag", function.pinned(registers.pinned[1]));
    if text.contains("slot") {
        let slot = function.add_slot(64, 16);
        names.insert("slot", function.slot_address(slot));
    }
    let mut reader = Reader {
        function,
        block,
        names,
        variables: HashMap::new(),
        target,
    };
    let mut tokens = spaced.split_whitespace();
    let mut last = Value::NONE;
    while let Some(node) = parse(&mut tokens) {
        last = reader.value(&node, I32);
    }
    let results: Vec<Value> = last.expand().into_iter().collect();
    let place = |&result: &Value| {
        Boundary::Register(if reader.function.type_of(result).is_int() {
            registers.return_gprs[0].into()
        } else {
            registers.return_fpr.into()
        })
    };
    let places: Vec<_> = results.iter().map(place).collect();
    reader.function.set_results(&places);
    reader.builder().ret(&results);
    reader.function
}
