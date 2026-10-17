use crate::declared::Part;
use crate::id::{FuncId, V};
use crate::ir::{BinOp, Def, Func, Literal, Op, Prediction, Program, RelOp, Target, Term, UnOp, CoerceReason};
use bun_sema::util::{InParallel, for_each_mut};
use smallvec::SmallVec;
use std::mem::MaybeUninit;

pub const MAGIC: u32 = 0x5249_5442;
pub const VERSION: u32 = 37;
pub const PROGRAM_LOGS_TYPE_ERRORS: u32 = 1;
pub const NONE: u32 = u32::MAX;
pub const PREDICTION_IS_CLOSURE: u32 = 1 << 31;
pub const PREDICTION_IS_BY_KEY: u32 = 1 << 30;
pub const RECEIVER_HAS_SINGLE_STRUCTURE: u32 = 1 << 29;
pub const VARIABLE_IS_INITIALIZED: u32 = 1;
pub const CALL_IS_IN_TAIL_POSITION: u32 = 1;
pub const CALL_IS_FUSED_WITH_MAP: u32 = 0;
pub const CAST_KEEPS_UNCONVERTIBLE_OBJECTS: u32 = 1 << 20;
pub const PARAMETER_IS_ANNOTATED: u32 = 1 << 31;

macro_rules! opcodes {
    ($($name:ident,)*) => {
        #[derive(Copy, Clone, PartialEq, Eq, Debug)]
        #[repr(u32)]
        pub enum Opcode {
            $($name,)*
        }

        const OPCODE_NAMES: &[&str] = &[$(stringify!($name),)*];
    };
}

opcodes! {
    Parameter,
    Undefined,
    Null,
    Boolean,
    Integer,
    Double,
    String,
    BigInt,
    FunctionReference,
    GetModuleVariable,
    PutModuleVariable,
    GetGlobal,
    GetGlobalForTypeOf,
    PutGlobal,
    NewObjectWithShape,
    GetField,
    PutField,
    NewClosure,
    NewClosureOnce,
    GetById,
    PutById,
    InById,
    DeleteById,
    GetByVal,
    PutByVal,
    InByVal,
    DeleteByVal,
    NewArray,
    NewObject,
    Add,
    Sub,
    Mul,
    Div,
    Mod,
    Pow,
    BitAnd,
    BitOr,
    BitXor,
    LShift,
    RShift,
    URShift,
    Negate,
    ToNumber,
    ToNumeric,
    BitNot,
    Less,
    LessEq,
    Greater,
    GreaterEq,
    StrictEq,
    Eq,
    LogicalNot,
    ToBoolean,
    TypeOf,
    InstanceOf,
    ToString,
    ToPropertyKey,
    IsUndefinedOrNull,
    IsInstanceOfClass,
    Strcat,
    IteratorOpen,
    IteratorHasNext,
    IteratorValue,
    IteratorClose,
    Call,
    Construct,
    CallMethod,
    CallDirect,
    Cast,
    CatchValue,
    LoopHint,
    UnlikelyHint,
    Operation,
    Await,
    GetExternalModule,
    Yield,
    GetResumeMode,
    ConstantSymbol,
}

fn opcode_names_hash() -> u32 {
    let mut hash = 2_166_136_261u32;
    for name in OPCODE_NAMES {
        for &byte in name.as_bytes().iter().chain(b"\n") {
            hash = (hash ^ byte as u32).wrapping_mul(16_777_619);
        }
    }
    hash
}

pub struct Record<'a> {
    pub opcode: Opcode,
    pub children: [V; 3],
    pub immediates: [u32; 2],
    pub args: &'a [V],
}

pub fn record(def: &Def) -> Record<'_> {
    let mut r = Record { opcode: Opcode::Undefined, children: [V::NONE; 3], immediates: [NONE; 2], args: &[] };
    let op = match def {
        Def::Param(block, index) => {
            r.opcode = Opcode::Parameter;
            r.immediates = [block.0, *index];
            return r;
        }
        Def::Op(op) => op,
    };
    let bits = |bits: u64| [bits as u32, (bits >> 32) as u32];
    match op {
        Op::Undefined => r.opcode = Opcode::Undefined,
        Op::Null => r.opcode = Opcode::Null,
        Op::Bool(b) => (r.opcode, r.immediates[0]) = (Opcode::Boolean, u32::from(*b)),
        Op::Int(i) => (r.opcode, r.immediates) = (Opcode::Integer, bits(*i as u64)),
        Op::Double(d) => (r.opcode, r.immediates) = (Opcode::Double, bits(*d)),
        Op::Str(s) => (r.opcode, r.immediates[0]) = (Opcode::String, s.0),
        Op::BigInt(s) => (r.opcode, r.immediates[0]) = (Opcode::BigInt, s.0),
        Op::Symbol(s) => (r.opcode, r.immediates[0]) = (Opcode::ConstantSymbol, s.0),
        Op::FuncRef(f) => (r.opcode, r.immediates[0]) = (Opcode::FunctionReference, f.0),
        Op::GlobalGet(g) => (r.opcode, r.immediates[0]) = (Opcode::GetModuleVariable, g.0),
        Op::GlobalSet(g, v) => (r.opcode, r.immediates[0], r.children[0]) = (Opcode::PutModuleVariable, g.0, *v),
        Op::FreeGet { name, is_typeof } => (r.opcode, r.immediates[0]) = (if *is_typeof { Opcode::GetGlobalForTypeOf } else { Opcode::GetGlobal }, name.0),
        Op::FreeSet { name, value } => (r.opcode, r.immediates[0], r.children[0]) = (Opcode::PutGlobal, name.0, *value),
        Op::New(l) => (r.opcode, r.immediates[0]) = (Opcode::NewObjectWithShape, l.0),
        Op::NewWith { layout, name, value } => (r.opcode, r.children[0], r.immediates) = (Opcode::NewObjectWithShape, *value, [layout.0, name.0]),
        Op::FieldGet { obj, layout, field } => (r.opcode, r.children[0], r.immediates) = (Opcode::GetField, *obj, [layout.0, *field]),
        Op::FieldSet { obj, layout, field, value } => (r.opcode, r.children[0], r.children[1], r.immediates) = (Opcode::PutField, *obj, *value, [layout.0, *field]),
        Op::Closure { func, captures } => (r.opcode, r.immediates[0], r.args) = (Opcode::NewClosure, func.0, captures),
        Op::ClosureOnce { func, captures, env, field } => (r.opcode, r.children[0], r.immediates, r.args) = (Opcode::NewClosureOnce, *env, [func.0, *field], captures),
        Op::PropGet { obj, name } => (r.opcode, r.children[0], r.immediates[0]) = (Opcode::GetById, *obj, name.0),
        Op::PropSet { obj, name, value } => (r.opcode, r.children[0], r.children[1], r.immediates[0]) = (Opcode::PutById, *obj, *value, name.0),
        Op::PropHas { obj, name } => (r.opcode, r.children[0], r.immediates[0]) = (Opcode::InById, *obj, name.0),
        Op::PropDelete { obj, name } => (r.opcode, r.children[0], r.immediates[0]) = (Opcode::DeleteById, *obj, name.0),
        Op::ElemGet { obj, key } => (r.opcode, r.children[0], r.children[1]) = (Opcode::GetByVal, *obj, *key),
        Op::ElemSet { obj, key, value } => (r.opcode, r.children) = (Opcode::PutByVal, [*obj, *key, *value]),
        Op::ElemHas { obj, key } => (r.opcode, r.children[0], r.children[1]) = (Opcode::InByVal, *obj, *key),
        Op::ElemDelete { obj, key } => (r.opcode, r.children[0], r.children[1]) = (Opcode::DeleteByVal, *obj, *key),
        Op::NewArray(args) => (r.opcode, r.args) = (Opcode::NewArray, args),
        Op::NewObject => r.opcode = Opcode::NewObject,
        Op::Binary { op, a, b } => {
            r.opcode = match op {
                BinOp::Add => Opcode::Add,
                BinOp::Sub => Opcode::Sub,
                BinOp::Mul => Opcode::Mul,
                BinOp::Div => Opcode::Div,
                BinOp::Mod => Opcode::Mod,
                BinOp::Exp => Opcode::Pow,
                BinOp::BitAnd => Opcode::BitAnd,
                BinOp::BitOr => Opcode::BitOr,
                BinOp::BitXor => Opcode::BitXor,
                BinOp::Shl => Opcode::LShift,
                BinOp::Shr => Opcode::RShift,
                BinOp::UShr => Opcode::URShift,
            };
            (r.children[0], r.children[1]) = (*a, *b);
        }
        Op::Unary { op, a } => {
            r.opcode = match op {
                UnOp::Neg => Opcode::Negate,
                UnOp::ToNumber => Opcode::ToNumber,
                UnOp::ToNumeric => Opcode::ToNumeric,
                UnOp::BitNot => Opcode::BitNot,
            };
            r.children[0] = *a;
        }
        Op::Relational { op, a, b } => {
            r.opcode = match op {
                RelOp::Lt => Opcode::Less,
                RelOp::Le => Opcode::LessEq,
                RelOp::Gt => Opcode::Greater,
                RelOp::Ge => Opcode::GreaterEq,
            };
            (r.children[0], r.children[1]) = (*a, *b);
        }
        Op::StrictEq { a, b } => (r.opcode, r.children[0], r.children[1]) = (Opcode::StrictEq, *a, *b),
        Op::LooseEq { a, b } => (r.opcode, r.children[0], r.children[1]) = (Opcode::Eq, *a, *b),
        Op::Not(a) => (r.opcode, r.children[0]) = (Opcode::LogicalNot, *a),
        Op::Truthy(a) => (r.opcode, r.children[0]) = (Opcode::ToBoolean, *a),
        Op::TypeOf(a) => (r.opcode, r.children[0]) = (Opcode::TypeOf, *a),
        Op::InstanceOf { value, of } => (r.opcode, r.children[0], r.children[1]) = (Opcode::InstanceOf, *value, *of),
        Op::ToStr(a) => (r.opcode, r.children[0]) = (Opcode::ToString, *a),
        Op::ToKey(a) => (r.opcode, r.children[0]) = (Opcode::ToPropertyKey, *a),
        Op::IsNullish(a) => (r.opcode, r.children[0]) = (Opcode::IsUndefinedOrNull, *a),
        Op::IsInstance { value, layout } => (r.opcode, r.children[0], r.immediates[0]) = (Opcode::IsInstanceOfClass, *value, layout.0),
        Op::StrConcat(args) => (r.opcode, r.args) = (Opcode::Strcat, args),
        Op::IterOpen(a) => (r.opcode, r.children[0]) = (Opcode::IteratorOpen, *a),
        Op::IterHas { iter, index } => (r.opcode, r.children[0], r.children[1]) = (Opcode::IteratorHasNext, *iter, *index),
        Op::IterGet { iter, index } => (r.opcode, r.children[0], r.children[1]) = (Opcode::IteratorValue, *iter, *index),
        Op::IterClose(a) => (r.opcode, r.children[0], r.immediates[0]) = (Opcode::IteratorClose, *a, 0),
        Op::IterCloseForThrow(a) => (r.opcode, r.children[0], r.immediates[0]) = (Opcode::IteratorClose, *a, 1),
        Op::Call { callee, this, args } => (r.opcode, r.children[0], r.children[1], r.args) = (Opcode::Call, *callee, *this, args),
        Op::Construct { callee, args } => (r.opcode, r.children[0], r.args) = (Opcode::Construct, *callee, args),
        Op::CallMethod { obj, name, args } => (r.opcode, r.children[0], r.immediates[0], r.args) = (Opcode::CallMethod, *obj, name.0, args),
        Op::CallDirect { func, args } => (r.opcode, r.immediates[0], r.args) = (Opcode::CallDirect, func.0, args),
        Op::Coerce { value, to, why: asserted } => {
            let why = match asserted {
                CoerceReason::Store => 0,
                CoerceReason::Cast => 1,
                CoerceReason::CastFresh => 1 | 1 << 8,
                CoerceReason::NonNull(_) => 2,
                CoerceReason::Claim => 3,
                CoerceReason::ArgumentClaim(number) => 3 | 1 << 10 | u32::from(*number) << 11,
                CoerceReason::Flow => 4,
                CoerceReason::Upcast | CoerceReason::Forced => 5,
                CoerceReason::Coerce => 6,
                CoerceReason::CoerceFreshGraph => 6 | 2 << 8,
            };
            let first = if let CoerceReason::NonNull(text) = asserted { text.0 } else { to.0 };
            (r.opcode, r.children[0], r.immediates) = (Opcode::Cast, *value, [first, why]);
        }
        Op::Caught => r.opcode = Opcode::CatchValue,
        Op::CaughtException => (r.opcode, r.immediates[0]) = (Opcode::CatchValue, 1),
        Op::Poll => r.opcode = Opcode::LoopHint,
        Op::UnlikelyHint => r.opcode = Opcode::UnlikelyHint,
        Op::Operation { which, args } => (r.opcode, r.immediates[0], r.args) = (Opcode::Operation, *which as u32, args),
        Op::ExternalModule(specifier) => (r.opcode, r.immediates[0]) = (Opcode::GetExternalModule, specifier.0),
        Op::Yield(value) => (r.opcode, r.children[0]) = (Opcode::Yield, *value),
        Op::ResumeMode => r.opcode = Opcode::GetResumeMode,
        Op::Await(value) => (r.opcode, r.children[0]) = (Opcode::Await, *value),
    }
    r
}

pub fn end_of(term: &Term) -> (u32, V, SmallVec<[&Target; 2]>, SmallVec<[i64; 1]>) {
    match term {
        Term::Jump(t) => (0, V::NONE, SmallVec::from_iter([t]), SmallVec::new()),
        Term::Branch { cond, then, otherwise } => (1, *cond, SmallVec::from_buf([then, otherwise]), SmallVec::new()),
        Term::Switch { value, cases, default } => {
            let mut targets: SmallVec<[&Target; 2]> = cases.iter().map(|(_, t)| t).collect();
            targets.push(default);
            (2, *value, targets, cases.iter().map(|(case, _)| *case).collect())
        }
        Term::Return(v) => (3, *v, SmallVec::new(), SmallVec::new()),
        Term::Throw { value, unwind, pos } => (4, *value, unwind.iter().collect(), if *pos == 0 { SmallVec::new() } else { SmallVec::from_buf([i64::from(*pos)]) }),
        Term::Invoke { normal, unwind } => (5, V::NONE, SmallVec::from_buf([normal, unwind]), SmallVec::new()),
        Term::Unreachable => (6, V::NONE, SmallVec::new(), SmallVec::new()),
    }
}

fn write_uleb128(out: &mut Vec<u8>, mut value: u32) {
    while value >= 0x80 {
        out.push(value as u8 | 0x80);
        value >>= 7;
    }
    out.push(value as u8);
}

pub fn line_table(text: &[u8], line_starts: &[u32]) -> Vec<u8> {
    let mut table = Vec::with_capacity(line_starts.len() + 16);
    write_uleb128(&mut table, line_starts.len() as u32);
    for (start, next) in line_starts.iter().zip(line_starts.iter().skip(1)) {
        write_uleb128(&mut table, next - start);
    }
    let (mut listed, mut number_listed, mut previous) = (Vec::new(), 0, 0);
    let mut characters: Vec<u32> = Vec::new();
    let is_ascii = text.is_ascii();
    for (line, &start) in line_starts.iter().enumerate().filter(|_| !is_ascii) {
        let end = line_starts.get(line + 1).map_or(text.len(), |&next| next as usize);
        let of_line = &text[start as usize..end];
        if of_line.is_ascii() {
            continue;
        }
        characters.clear();
        let (mut at, mut after_last) = (0, 0);
        while at < of_line.len() {
            let length = match of_line[at] {
                0xC0..=0xDF => 2,
                0xE0..=0xEF => 3,
                0xF0..=0xFF => 4,
                _ => {
                    at += 1;
                    continue;
                }
            };
            characters.push(((at - after_last) as u32) << 2 | (length as u32 - 2));
            at += length;
            after_last = at;
        }
        if characters.is_empty() {
            continue;
        }
        write_uleb128(&mut listed, line as u32 - previous);
        write_uleb128(&mut listed, characters.len() as u32);
        for &character in &characters {
            write_uleb128(&mut listed, character);
        }
        (number_listed, previous) = (number_listed + 1, line as u32);
    }
    write_uleb128(&mut table, number_listed);
    table.extend_from_slice(&listed);
    table
}

#[derive(Default)]
struct Writer {
    bytes: Vec<u8>,
    words: Vec<u32>,
    strings: Vec<u32>,
    declared: Vec<u32>,
    parts: Vec<u32>,
    shapes: Vec<u32>,
    fields: Vec<u32>,
    methods: Vec<u32>,
    variables: Vec<u32>,
    modules: Vec<u32>,
    webassembly_modules: Vec<u32>,
}

struct OutputSlice<'a>(&'a mut [MaybeUninit<u8>]);

impl<'a> OutputSlice<'a> {
    fn take(&mut self, bytes: usize) -> OutputSlice<'a> {
        let (here, behind) = std::mem::take(&mut self.0).split_at_mut(bytes);
        self.0 = behind;
        OutputSlice(here)
    }

    fn put<const N: usize>(&mut self, words: [u32; N]) {
        for (place, word) in self.take(4 * N).0.as_chunks_mut::<4>().0.iter_mut().zip(words) {
            place.write_copy_of_slice(&word.to_le_bytes());
        }
    }
}

struct FunctionWriter<'a> {
    words: OutputSlice<'a>,
    functions: OutputSlice<'a>,
    blocks: OutputSlice<'a>,
    values: OutputSlice<'a>,
    targets: OutputSlice<'a>,
    next_word: u32,
    next_block: u32,
    next_value: u32,
    next_target: u32,
}

fn table_lengths(funcs: &[Func]) -> [u32; 4] {
    let (mut words, mut blocks, mut values, mut targets) = (0usize, 0usize, 0usize, 0usize);
    for func in funcs {
        words += func.params.len() + func.captures.len();
        blocks += func.blocks.len();
        values += func.values.len();
        for value in &func.values {
            if let Def::Op(
                Op::Closure { captures: args, .. }
                | Op::ClosureOnce { captures: args, .. }
                | Op::NewArray(args)
                | Op::StrConcat(args)
                | Op::Call { args, .. }
                | Op::Construct { args, .. }
                | Op::CallMethod { args, .. }
                | Op::CallDirect { args, .. }
                | Op::Operation { args, .. },
            ) = &value.def
            {
                words += args.len();
            }
        }
        for block in &func.blocks {
            words += block.params.len() + block.ops.len();
            let mut count = |target: &Target| {
                targets += 1;
                words += target.args.len();
            };
            match &block.term {
                Some(Term::Jump(target)) => count(target),
                Some(Term::Branch { then: first, otherwise: second, .. } | Term::Invoke { normal: first, unwind: second }) => {
                    count(first);
                    count(second);
                }
                Some(Term::Switch { cases, default, .. }) => {
                    cases.iter().for_each(|case| count(&case.1));
                    count(default);
                    words += 2 * cases.len();
                }
                Some(Term::Throw { unwind, pos, .. }) => {
                    unwind.iter().for_each(&mut count);
                    words += if *pos == 0 { 0 } else { 2 };
                }
                Some(Term::Return(_) | Term::Unreachable) | None => {}
            }
        }
    }
    [words as u32, blocks as u32, values as u32, targets as u32]
}

const SIZES: [u32; 12] = [2, 8, 4, 20, 8, 5, 6, 7, 18, 10, 11, 3];

impl Writer {
    fn list(&mut self, words: impl IntoIterator<Item = u32>) -> [u32; 2] {
        let start = self.words.len() as u32;
        self.words.extend(words);
        [start, self.words.len() as u32 - start]
    }
}

impl FunctionWriter<'_> {
    fn list(&mut self, words: impl IntoIterator<Item = u32>) -> [u32; 2] {
        let start = self.next_word;
        for word in words {
            self.words.put([word]);
            self.next_word += 1;
        }
        [start, self.next_word - start]
    }

    fn functions(&mut self, funcs: &[Func], first: usize, single_structure_accesses: &[(FuncId, V)], flagged_values: &[Vec<V>], known_slots: &[(FuncId, V, u32)]) {
        let (first_id, end_id) = (FuncId::new(first), FuncId::new(first + funcs.len()));
        let known_slots = &known_slots[known_slots.partition_point(|access| access.0 < first_id)..known_slots.partition_point(|access| access.0 < end_id)];
        let single_structure_accesses = &single_structure_accesses[single_structure_accesses.partition_point(|access| access.0 < first_id)..single_structure_accesses.partition_point(|access| access.0 < end_id)];
        let mut is_marked: Vec<bool> = Vec::new();
        for (index, func) in funcs.iter().enumerate() {
            let id = FuncId::new(first + index);
            let mut placed = known_slots[known_slots.partition_point(|access| access.0 < id)..].iter().take_while(|access| access.0 == id).peekable();
            let flagged_values = &flagged_values[first + index];
            is_marked.clear();
            if !flagged_values.is_empty() {
                is_marked.resize(func.values.len(), false);
            }
            for v in flagged_values {
                if let Some(mark) = is_marked.get_mut(v.idx()) {
                    *mark = true;
                }
            }
            let mut labelled = single_structure_accesses[single_structure_accesses.partition_point(|access| access.0 < id)..].iter().take_while(|access| access.0 == id).peekable();
            let parameters = self.list(func.params.iter().enumerate().map(|(i, t)| if t.is_some() && func.param_cast_reason(i) == CoerceReason::Cast { t.0 | PARAMETER_IS_ANNOTATED } else { t.0 }));
            let captures = self.list(func.captures.iter().map(|ty| ty.0));
            let (blocks, values) = (self.next_block, self.next_value);
            for (number, value) in func.values.iter().enumerate() {
                let mut r = record(&value.def);
                if value.is_known_initialized() && matches!(r.opcode, Opcode::GetModuleVariable) {
                    r.immediates[1] = VARIABLE_IS_INITIALIZED;
                }
                if value.is_in_tail_position() && matches!(r.opcode, Opcode::Call | Opcode::CallMethod | Opcode::CallDirect | Opcode::Operation) {
                    r.immediates[1] = CALL_IS_IN_TAIL_POSITION;
                }
                if value.keeps_unconvertible_objects() && matches!(r.opcode, Opcode::Cast) && matches!(r.immediates[1] & 0xff, 1 | 4) {
                    r.immediates[1] |= CAST_KEEPS_UNCONVERTIBLE_OBJECTS;
                }
                if is_marked.get(number) == Some(&true) {
                    r.immediates[1] = if matches!(r.opcode, Opcode::CallMethod) { CALL_IS_FUSED_WITH_MAP } else { 1 };
                }
                if value.signature.is_some() && matches!(r.opcode, Opcode::Call | Opcode::CallMethod) {
                    r.immediates[1] = 2 + (value.signature.0 << 1 | u32::from(value.is_in_tail_position()));
                }
                let is_labeled = labelled.next_if(|access| access.1.idx() == number).is_some();
                let place = placed.next_if(|access| access.1.idx() == number).map(|access| access.2);
                assert!(place.is_none() || matches!(r.opcode, Opcode::GetById | Opcode::PutById), "a location is attached to something that is not an access by name");
                assert!(placed.peek().is_none_or(|access| access.1.idx() > number), "two words stand on one access, or the table is not sorted");
                assert!(!is_labeled || matches!(r.opcode, Opcode::GetById | Opcode::PutById), "a label is attached to something that is not an access by name");
                let arguments = self.list(r.args.iter().map(|v| v.0));
                let prediction = match value.prediction() {
                    Prediction::None => NONE,
                    Prediction::Ty(ty) | Prediction::Field(ty) => ty.0,
                    Prediction::Closure(func) => PREDICTION_IS_CLOSURE | func.0,
                    Prediction::ByKey(property) => PREDICTION_IS_BY_KEY | property.0,
                };
                self.next_value += 1;
                self.values.put([
                    r.opcode as u32,
                    value.pos,
                    r.children[0].0,
                    r.children[1].0,
                    r.children[2].0,
                    r.immediates[0],
                    place.unwrap_or(if is_labeled { RECEIVER_HAS_SINGLE_STRUCTURE } else { r.immediates[1] }),
                    arguments[0],
                    arguments[1],
                    value.ty.0,
                    prediction,
                ]);
            }
            for block in &func.blocks {
                let parameters = self.list(block.params.iter().map(|v| v.0));
                let ops = self.list(block.ops.iter().map(|v| v.0));
                let (kind, value, targets, cases) = end_of(block.term.as_ref().unwrap_or(&Term::Unreachable));
                let first = self.next_target;
                for target in &targets {
                    let arguments = self.list(target.args.iter().map(|v| v.0));
                    self.next_target += 1;
                    self.targets.put([target.block.0, arguments[0], arguments[1]]);
                }
                let cases = self.list(cases.iter().flat_map(|&case| [case as u32, (case as u64 >> 32) as u32]));
                self.next_block += 1;
                self.blocks.put([parameters[0], parameters[1], ops[0], ops[1], kind, value.0, first, targets.len() as u32, cases[0], cases[1]]);
            }
            self.functions.put([
                func.name.0,
                func.module.0,
                func.pos,
                func.kind as u32,
                func.flags as u32,
                captures[0],
                captures[1],
                func.declared_this_type.0,
                parameters[0],
                parameters[1],
                blocks,
                func.blocks.len() as u32,
                values,
                func.values.len() as u32,
                func.length as u32,
                func.result.0,
                func.source_start,
                func.source_end,
            ]);
        }
        assert!([&self.words, &self.functions, &self.blocks, &self.values, &self.targets].iter().all(|room| room.0.is_empty()), "the functions take as much room as was counted");
    }
}

const FUNCTIONS_PER_SLICE: usize = 256;

fn site_table(p: &Program, in_parallel: InParallel<'_>) -> Vec<u32> {
    const REASONS: [&str; 7] = ["As", "Store", "Claim", "Flow", "NonNull", "Coerce", "IteratorOpen"];
    fn text(table: &mut Vec<u32>, bytes: &[u8]) {
        table.push(bytes.len() as u32);
        let mut words = vec![0u32; bytes.len() / 4 + 1];
        for (i, &byte) in bytes.iter().enumerate() {
            words[i / 4] |= u32::from(byte) << (i % 4 * 8);
        }
        table.append(&mut words);
    }
    const _: () = assert!(crate::audit::Kind::ALL.len() <= 32);
    let kinds = crate::audit::Kind::ALL;
    let number_of = |kind: crate::audit::Kind| kinds.iter().position(|&listed| listed == kind).unwrap_or(0) as u32;
    let mut table = vec![kinds.len() as u32];
    for kind in kinds {
        text(&mut table, kind.as_str().as_bytes());
    }
    table.push(REASONS.len() as u32);
    for reason in REASONS {
        text(&mut table, reason.as_bytes());
    }
    let mut sites = crate::audit::sites(p, in_parallel);
    sites.retain(|site| site.column < 1 << 20);
    sites.sort_by_key(|site| (site.module, site.line, site.column, number_of(site.kind), site.ordinal));
    table.push(sites.chunk_by(|a, b| a.module == b.module).count() as u32);
    for of_module in sites.chunk_by(|a, b| a.module == b.module) {
        text(&mut table, p.strs.get(p.modules[of_module[0].module as usize].display_path));
        table.push(of_module.len() as u32);
        for site in of_module {
            let reason = REASONS.iter().position(|&reason| reason == site.what).unwrap_or(REASONS.len()) as u32;
            table.extend([site.line, site.column << 12 | site.ordinal.min(15) << 8 | reason << 5 | number_of(site.kind)]);
        }
    }
    table
}

enum Slice<'a> {
    Lent(&'a [Func]),
    Released(&'a mut [Func]),
}

impl Slice<'_> {
    fn funcs(&self) -> &[Func] {
        match self {
            Slice::Lent(funcs) => funcs,
            Slice::Released(funcs) => funcs,
        }
    }

    fn release(&mut self) {
        if let Slice::Released(funcs) = self {
            for func in funcs.iter_mut() {
                func.captures = Vec::new();
                func.params = Vec::new();
                func.annotated = Vec::new();
                func.blocks = Vec::new();
                func.values = Vec::new();
                func.spans = Vec::new();
            }
        }
        *self = Slice::Lent(&[]);
    }
}

enum Piece<'a, 'f> {
    Functions(usize, &'a mut Slice<'f>, FunctionWriter<'a>),
    Words(OutputSlice<'a>, &'a [u32]),
    Bytes(OutputSlice<'a>, &'a [u8]),
    Modules(OutputSlice<'a>, &'a [crate::ir::Module]),
}

fn copy_words<'a, 'f>(room: &mut OutputSlice<'a>, words: &'a [u32], pieces: &mut Vec<Piece<'a, 'f>>) {
    const WORDS_PER_PIECE: usize = 1 << 18;
    pieces.extend(words.chunks(WORDS_PER_PIECE).map(|piece| Piece::Words(room.take(4 * piece.len()), piece)));
}

pub fn write(p: &Program, in_parallel: InParallel<'_>) -> Vec<u8> {
    let site_table_words = if p.logs_type_errors { site_table(p, in_parallel) } else { Vec::new() };
    write_slices(p, p.funcs.len(), p.funcs.chunks(FUNCTIONS_PER_SLICE).map(Slice::Lent).collect(), site_table_words, in_parallel)
}

pub fn write_releasing(p: &mut Program, in_parallel: InParallel<'_>) -> Vec<u8> {
    let site_table_words = if p.logs_type_errors { site_table(p, in_parallel) } else { Vec::new() };
    let mut funcs = std::mem::take(&mut p.funcs);
    let number = funcs.len();
    let slices = funcs.chunks_mut(FUNCTIONS_PER_SLICE).map(Slice::Released).collect();
    write_slices(p, number, slices, site_table_words, in_parallel)
}

fn write_slices(p: &Program, func_count: usize, funcs: Vec<Slice<'_>>, site_table_words: Vec<u32>, in_parallel: InParallel<'_>) -> Vec<u8> {
    let write_tables = || {
    let mut w = Writer::default();
    for i in 0..p.strs.len() {
        let bytes = p.strs.get(crate::id::StrId::new(i));
        w.strings.extend([w.bytes.len() as u32, bytes.len() as u32]);
        w.bytes.extend_from_slice(bytes);
    }
    for module in &p.webassembly_modules {
        w.webassembly_modules.extend([w.bytes.len() as u32, module.len() as u32]);
        w.bytes.extend_from_slice(module);
    }
    for declared in &p.tys.list {
        let flags = u32::from(declared.any_object) | u32::from(declared.any_function) << 1 | u32::from(declared.ints.is_some()) << 2;
        let (minimum, maximum) = declared.ints.unwrap_or((0, 0));
        let first = w.parts.len() as u32 / SIZES[2];
        for part in &declared.parts {
            let (kind, index, arguments) = match part {
                Part::Class(shape) => (0, shape.0, [0, 0]),
                Part::Global(name, args) => (1, name.0, w.list(args.iter().map(|t| t.0))),
                Part::Array(element) => (2, NONE, w.list([element.0])),
            };
            w.parts.extend([kind, index, arguments[0], arguments[1]]);
        }
        w.declared.extend([declared.prims, flags, minimum as u32, (minimum as u64 >> 32) as u32, maximum as u32, (maximum as u64 >> 32) as u32, first, declared.parts.len() as u32]);
    }
    for layout in &p.layouts {
        let (fields, methods) = (w.fields.len() as u32 / SIZES[4], w.methods.len() as u32 / SIZES[5]);
        for field in &layout.fields {
            let literals = w.list(field.literals.iter().flat_map(|literal| match *literal {
                Literal::Str(text) => [0, text.0, 0],
                Literal::Num(value) => [1, value.to_bits() as u32, (value.to_bits() >> 32) as u32],
            }));
            w.fields.extend([field.name.0, field.declared.0, field.flags as u32, literals[0], literals[1], field.type_text.0, field.single_function.0, field.single_function_flags as u32]);
        }
        for method in &layout.methods {
            w.methods.extend([method.name.0, method.func.0, method.kind as u32, method.flags as u32, method.key]);
        }
        let members = w.list(layout.members.iter().map(|member| member.0));
        let structural_subtypes = w.list(layout.structural_subtypes.iter().map(|member| member.0));
        let specializations = w.list(layout.specializations.iter().map(|specialization| specialization.0));
        let static_fields = w.list(layout.static_fields.iter().flat_map(|&(name, declared)| [name.0, declared.0]));
        w.shapes.extend([
            layout.kind as u32,
            layout.name.0,
            layout.base.0,
            fields,
            layout.fields.len() as u32,
            methods,
            layout.methods.len() as u32,
            layout.constructor.0,
            u32::from(layout.is_allocated) | u32::from(layout.may_be_frozen) << 1 | layout.class_flags | u32::from(layout.accepts_untyped) << 7 | u32::from(layout.is_relaxed_for_logging) << 11 | u32::from(layout.accepts_only_other_layouts) << 12,
            members[0],
            members[1],
            structural_subtypes[0],
            structural_subtypes[1],
            specializations[0],
            specializations[1],
            layout.environment.0,
            static_fields[0],
            static_fields[1],
            layout.declared_path.0,
            layout.declared_line,
        ]);
    }
    for global in &p.globals {
        w.variables.extend([global.name.0, global.module.0, global.declared.0, if global.initialization == crate::ir::Initialization::Lazy { crate::ir::Initialization::Undefined as u32 } else { global.initialization as u32 }, global.single_function.0, global.single_function_flags as u32]);
    }
    let mut end = w.bytes.len();
    for module in &p.modules {
        w.modules.extend([module.path.0, module.init.0, module.display_path.0, end as u32, module.line_table.len() as u32]);
        end += module.line_table.len();
        w.modules.extend([end as u32, module.printed.len() as u32]);
        end += module.printed.len();
    }
    w
    };
    let mut slices: Vec<(Slice<'_>, [u32; 4])> = funcs.into_iter().map(|funcs| (funcs, [0; 4])).collect();
    let no_flagged_values: Vec<Vec<V>> = if p.flagged_values.len() == func_count { Vec::new() } else { vec![Vec::new(); func_count] };
    let flagged_values = if p.flagged_values.len() == func_count { &p.flagged_values } else { &no_flagged_values };
    let mut w = std::thread::scope(|scope| {
        let tables = scope.spawn(write_tables);
        for_each_mut(&mut slices, in_parallel, &|(funcs, lengths)| *lengths = table_lengths(funcs.funcs()));
        tables.join().expect("the table writer thread panicked")
    });
    let mut before = [w.words.len() as u32, 0, 0, 0];
    let starts: Vec<[u32; 4]> = (slices.iter())
        .map(|(_, lengths)| {
            let behind = before;
            before = [0, 1, 2, 3].map(|i| before[i] + lengths[i]);
            behind
        })
        .collect();

    let head = std::mem::take(&mut w.words);
    let webassembly_modules = std::mem::take(&mut w.webassembly_modules);
    let mut list = |words: &mut dyn Iterator<Item = u32>| {
        let [start, length] = w.list(words);
        [before[0] + start, length]
    };
    let extended_globals = list(&mut p.extended_globals.iter().map(|name| name.0));
    let prototype_property_names = list(&mut p.prototype_property_names.iter().map(|name| name.0));
    let builtin_modules = list(&mut p.builtin_modules.iter().flat_map(|&(id, func)| [id, func.0]));
    let builtin_functions = list(&mut p.builtin_functions.iter().flat_map(|&(id, func, visibility)| [id, func.0, visibility]));
    let functions_by_key = list(&mut p.functions_by_key.iter().flat_map(|&(property, key, func)| [property.0, key.0, func.0]));
    let entries = list(&mut p.entries.iter().map(|func| func.0));
    let regexp_literals = list(&mut p.regexp_literals.iter().flat_map(|&(pattern, flags)| [pattern.0, flags.0]));
    let sites = list(&mut site_table_words.into_iter());
    let webassembly_modules = list(&mut webassembly_modules.into_iter());

    let bytes_of = |modules: &[crate::ir::Module]| modules.iter().map(|module| module.line_table.len() + module.printed.len()).sum::<usize>();
    let number_of_bytes = (w.bytes.len() + bytes_of(&p.modules)) as u32;
    let padding = &[0u8; 3][..number_of_bytes.wrapping_neg() as usize % 4];
    const HEADER_WORDS: usize = 6 + 14 * 2 + 18 + 12;
    let small_tables: [&[u32]; 8] = [&w.strings, &w.declared, &w.parts, &w.shapes, &w.fields, &w.methods, &w.variables, &w.modules];
    let lengths: [usize; 13] = [
        before[0] as usize + w.words.len(),
        w.strings.len(),
        w.declared.len(),
        w.parts.len(),
        w.shapes.len(),
        w.fields.len(),
        w.methods.len(),
        w.variables.len(),
        w.modules.len(),
        func_count * SIZES[8] as usize,
        before[1] as usize * SIZES[9] as usize,
        before[2] as usize * SIZES[10] as usize,
        before[3] as usize * SIZES[11] as usize,
    ];
    let mut header: Vec<u32> = vec![MAGIC, VERSION, 0, opcode_names_hash(), crate::builtins_generated::BUILTINS_HASH, if p.logs_type_errors { PROGRAM_LOGS_TYPE_ERRORS } else { 0 }];
    let mut offset = HEADER_WORDS * 4;
    header.extend([offset as u32, number_of_bytes]);
    offset += number_of_bytes as usize + padding.len();
    for (length, size) in lengths.into_iter().zip(std::iter::once(1).chain(SIZES)) {
        header.extend([offset as u32, length as u32 / size]);
        offset += length * 4;
    }
    header.extend(extended_globals);
    header.extend(prototype_property_names);
    header.extend(builtin_modules);
    header.extend(builtin_functions);
    header.extend(functions_by_key);
    header.extend(entries);
    header.extend(regexp_literals);
    header.extend(sites);
    header.extend(webassembly_modules);
    header.extend(SIZES.iter().map(|words| words * 4));
    header[2] = offset as u32;
    debug_assert_eq!(header.len(), HEADER_WORDS);
    let mut out = Vec::with_capacity(offset);
    let mut room = OutputSlice(&mut out.spare_capacity_mut()[..offset]);
    let mut copied: Vec<Piece<'_, '_>> = Vec::new();
    copy_words(&mut room, &header, &mut copied);
    const MODULES_PER_PIECE: usize = 64;
    const BYTES_PER_PIECE: usize = 1 << 20;
    copied.extend(w.bytes.chunks(BYTES_PER_PIECE).map(|piece| Piece::Bytes(room.take(piece.len()), piece)));
    copied.extend(p.modules.chunks(MODULES_PER_PIECE).map(|modules| Piece::Modules(room.take(bytes_of(modules)), modules)));
    copied.push(Piece::Bytes(room.take(padding.len()), padding));
    copy_words(&mut room, &head, &mut copied);
    let mut capacities: [Vec<OutputSlice<'_>>; 5] = Default::default();
    capacities[0] = slices.iter().map(|slice| room.take(4 * slice.1[0] as usize)).collect();
    copy_words(&mut room, &w.words, &mut copied);
    for table in small_tables {
        copy_words(&mut room, table, &mut copied);
    }
    capacities[1] = slices.iter().map(|slice| room.take(4 * SIZES[8] as usize * slice.0.funcs().len())).collect();
    for table in 1..4 {
        capacities[table + 1] = slices.iter().map(|slice| room.take(4 * SIZES[8 + table] as usize * slice.1[table] as usize)).collect();
    }
    assert!(room.0.is_empty());
    let [words, functions, blocks, values, targets] = capacities.map(Vec::into_iter);
    let mut pieces: Vec<Piece<'_, '_>> = (slices.iter_mut().zip(starts).zip(words).zip(functions).zip(blocks).zip(values).zip(targets).enumerate())
        .map(|(number, (((((((funcs, _), [next_word, next_block, next_value, next_target]), words), functions), blocks), values), targets))| {
            Piece::Functions(number * FUNCTIONS_PER_SLICE, funcs, FunctionWriter { words, functions, blocks, values, targets, next_word, next_block, next_value, next_target })
        })
        .collect();
    copied.append(&mut pieces);
    let mut pieces = copied;
    for_each_mut(&mut pieces, in_parallel, &|piece| match piece {
        Piece::Functions(first, funcs, writer) => {
            writer.functions(funcs.funcs(), *first, &p.single_structure_accesses, flagged_values, &p.known_slots);
            funcs.release();
        }
        Piece::Words(room, words) if cfg!(target_endian = "little") => {
            // SAFETY: every byte of a `u32` is initialized, and a byte is aligned anywhere.
            room.0.write_copy_of_slice(unsafe { words.align_to::<u8>() }.1);
        }
        Piece::Words(room, words) => words.iter().for_each(|&word| room.put([word])),
        Piece::Bytes(room, bytes) => {
            room.0.write_copy_of_slice(bytes);
        }
        Piece::Modules(room, modules) => {
            for bytes in modules.iter().flat_map(|module| [&module.line_table, &module.printed]) {
                room.take(bytes.len()).0.write_copy_of_slice(bytes);
            }
        }
    });
    drop(pieces);
    // SAFETY: the pieces are all of the first `offset` bytes, and each has been written.
    unsafe { out.set_len(offset) };
    out
}

#[cfg(test)]
mod tests {
    use super::line_table;

    #[test]
    fn line_table_ascii() {
        assert_eq!(line_table(b"", &[0]), [1, 0]);
        assert_eq!(line_table(b"a\nbc\r\nd", &[0, 2, 6]), [3, 2, 4, 0]);
        let long = [&[b'x'; 199][..], b"\ny"].concat();
        assert_eq!(line_table(&long, &[0, 200]), [2, 0xC8, 0x01, 0]);
    }

    #[test]
    fn line_table_non_ascii() {
        assert_eq!(line_table("a\n\u{e9}=1\n\u{1f600}x".as_bytes(), &[0, 2, 7]), [3, 2, 5, 2, 1, 1, 0, 1, 1, 2]);
        assert_eq!(line_table("ab\u{20ac}c\u{20ac}".as_bytes(), &[0]), [1, 1, 0, 2, 2 << 2 | 1, 1 << 2 | 1]);
        assert_eq!(line_table("\u{e9}\n\n\n\u{e9}".as_bytes(), &[0, 3, 4, 5]), [4, 3, 1, 1, 2, 0, 1, 0, 3, 1, 0]);
    }
}
