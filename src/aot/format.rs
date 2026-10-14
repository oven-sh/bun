//! The program as one buffer of 32-bit words that the engine reads in place. This mirrors
//! Source/JavaScriptCore/aot/AOTTypedFormat.h of the engine: the order of the operations, of the sections and of the words of a
//! record is that of the header. The sizes of the records travel along, so that a difference is an error and not a wrong program.

use crate::declared::Part;
use crate::id::{FuncId, V};
use crate::ir::{BinOp, Def, Func, Literal, Op, Prediction, Program, RelOp, Target, Term, UnOp, Why};
use bun_sema::util::{InParallel, for_each_mut};

pub const MAGIC: u32 = 0x5249_5442;
pub const VERSION: u32 = 34;
pub const PROGRAM_LOGS_TYPE_ERRORS: u32 = 1;
pub const NONE: u32 = u32::MAX;
/// In the prediction of a value: the other bits number a function, which the value is expected to be a closure of, and not a type.
pub const PREDICTION_IS_CLOSURE: u32 = 1 << 31;
pub const PREDICTION_IS_BY_KEY: u32 = 1 << 30;
pub const RECEIVER_IS_OF_ONE_ROW: u32 = 1 << 29;
pub const VARIABLE_IS_INITIALIZED: u32 = 1;
/// In the type of a parameter of a function: it is written down. The other bits number the type. Not in `NONE`.
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
    Operation,
    Await,
    GetExternalModule,
    Yield,
    GetResumeMode,
}

/// Of the names of the operations in their order, each followed by a line feed: FNV-1a. The engine turns away a program whose
/// operations are numbered another way than its own.
fn hash_of_opcode_names() -> u32 {
    let mut hash = 2_166_136_261u32;
    for name in OPCODE_NAMES {
        for &byte in name.as_bytes().iter().chain(b"\n") {
            hash = (hash ^ byte as u32).wrapping_mul(16_777_619);
        }
    }
    hash
}

/// A value as a record of the format.
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
                Why::Store => 0,
                Why::Cast => 1,
                Why::CastFresh => 1 | 1 << 8,
                Why::NonNull(_) => 2,
                Why::Claim => 3,
                Why::Flow => 4,
                Why::Upcast | Why::Forced => 5,
                Why::Coerce => 6,
                Why::CoerceFreshGraph => 6 | 2 << 8,
            };
            // The type is that of the value, but for `Why::Coerce`.
            let first = if let Why::NonNull(text) = asserted { text.0 } else { to.0 };
            (r.opcode, r.children[0], r.immediates) = (Opcode::Cast, *value, [first, why]);
        }
        Op::Caught => r.opcode = Opcode::CatchValue,
        Op::CaughtException => (r.opcode, r.immediates[0]) = (Opcode::CatchValue, 1),
        Op::Poll => r.opcode = Opcode::LoopHint,
        Op::Operation { name, args } => (r.opcode, r.immediates[0], r.args) = (Opcode::Operation, name.0, args),
        Op::ExternalModule(specifier) => (r.opcode, r.immediates[0]) = (Opcode::GetExternalModule, specifier.0),
        Op::Yield(value) => (r.opcode, r.children[0]) = (Opcode::Yield, *value),
        Op::ResumeMode => r.opcode = Opcode::GetResumeMode,
        Op::Await(value) => (r.opcode, r.children[0]) = (Opcode::Await, *value),
    }
    r
}

/// The end of a block as the format has it: its kind, its value, its targets in order, and the cases of a switch.
pub fn end_of(term: &Term) -> (u32, V, Vec<&Target>, Vec<i64>) {
    match term {
        Term::Jump(t) => (0, V::NONE, vec![t], Vec::new()),
        Term::Branch { cond, then, otherwise } => (1, *cond, vec![then, otherwise], Vec::new()),
        Term::Switch { value, cases, default } => {
            let mut targets: Vec<&Target> = cases.iter().map(|(_, t)| t).collect();
            targets.push(default);
            (2, *value, targets, cases.iter().map(|(case, _)| *case).collect())
        }
        Term::Return(v) => (3, *v, Vec::new(), Vec::new()),
        Term::Throw { value, unwind, pos } => (4, *value, unwind.iter().collect(), if *pos == 0 { Vec::new() } else { vec![i64::from(*pos)] }),
        Term::Invoke { normal, unwind } => (5, V::NONE, vec![normal, unwind], Vec::new()),
        Term::Unreachable => (6, V::NONE, Vec::new(), Vec::new()),
    }
}

fn write_uleb128(out: &mut Vec<u8>, mut value: u32) {
    while value >= 0x80 {
        out.push(value as u8 | 0x80);
        value >>= 7;
    }
    out.push(value as u8);
}

/// What it takes to get from a position in `text`, which counts bytes, to a line and a column, which counts UTF-16 code units.
/// `line_starts`: where each line starts, the first at 0. All numbers are ULEB128:
///
/// * How many lines there are, and the length in bytes of each but the last, with what ends it.
/// * How many lines have a character that is not ASCII. For each, in order: how many lines after the one before it it is, the first
///   counting from line 0; how many such characters it has; and for each of those `gap << 2 | length - 2`. `gap`: the bytes between the
///   end of the one before it, or the start of the line, and this one. `length`: the bytes it takes, 2 to 4.
pub fn line_table(text: &[u8], line_starts: &[u32]) -> Vec<u8> {
    let mut table = Vec::new();
    write_uleb128(&mut table, line_starts.len() as u32);
    for pair in line_starts.windows(2) {
        write_uleb128(&mut table, pair[1] - pair[0]);
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
                // ASCII, or a byte that no character starts with where one should start.
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
    functions: Vec<u32>,
    blocks: Vec<u32>,
    values: Vec<u32>,
    targets: Vec<u32>,
}

const SIZES: [u32; 12] = [2, 8, 4, 20, 8, 5, 6, 7, 18, 10, 11, 3];

impl Writer {
    /// The words as a list in the pool: where it starts and how long it is.
    fn list(&mut self, words: impl IntoIterator<Item = u32>) -> [u32; 2] {
        let start = self.words.len() as u32;
        self.words.extend(words);
        [start, self.words.len() as u32 - start]
    }

    fn functions(&mut self, funcs: &[Func], first: usize, accesses_of_one_row: &[(FuncId, V)], marked_values: &[Vec<V>], known_places: &[(FuncId, V, u32)]) {
        let mut is_marked: Vec<bool> = Vec::new();
        for (index, func) in funcs.iter().enumerate() {
            let id = FuncId::new(first + index);
            let mut placed = known_places[known_places.partition_point(|access| access.0 < id)..].iter().take_while(|access| access.0 == id).peekable();
            let marked_values = &marked_values[first + index];
            is_marked.clear();
            if !marked_values.is_empty() {
                is_marked.resize(func.values.len(), false);
            }
            for v in marked_values {
                if let Some(mark) = is_marked.get_mut(v.idx()) {
                    *mark = true;
                }
            }
            let mut labelled = accesses_of_one_row[accesses_of_one_row.partition_point(|access| access.0 < id)..].iter().take_while(|access| access.0 == id).peekable();
            let parameters = self.list(func.params.iter().enumerate().map(|(i, t)| if t.is_some() && func.why_of_param(i) == Why::Cast { t.0 | PARAMETER_IS_ANNOTATED } else { t.0 }));
            let captures = self.list(func.captures.iter().map(|ty| ty.0));
            let (blocks, values) = (self.blocks.len() as u32 / SIZES[9], self.values.len() as u32 / SIZES[10]);
            for (number, value) in func.values.iter().enumerate() {
                let mut r = record(&value.def);
                if value.finds_initialized && matches!(r.opcode, Opcode::GetModuleVariable) {
                    r.immediates[1] = VARIABLE_IS_INITIALIZED;
                }
                if is_marked.get(number) == Some(&true) {
                    r.immediates[1] = 1;
                }
                let is_labelled = labelled.next_if(|access| access.1.idx() == number).is_some();
                let place = placed.next_if(|access| access.1.idx() == number).map(|access| access.2);
                assert!(place.is_none() || matches!(r.opcode, Opcode::GetById | Opcode::PutById), "a place stands on what is no access by name");
                assert!(placed.peek().is_none_or(|access| access.1.idx() > number), "two words stand on one access, or the table is not sorted");
                assert!(!is_labelled || matches!(r.opcode, Opcode::GetById | Opcode::PutById), "a label stands on what is no access by name");
                let arguments = self.list(r.args.iter().map(|v| v.0));
                let prediction = match value.prediction {
                    Prediction::None => NONE,
                    Prediction::Ty(ty) | Prediction::Field(ty) => ty.0,
                    Prediction::Closure(func) => PREDICTION_IS_CLOSURE | func.0,
                    Prediction::ByKey(property) => PREDICTION_IS_BY_KEY | property.0,
                };
                self.values.extend([
                    r.opcode as u32,
                    value.pos,
                    r.children[0].0,
                    r.children[1].0,
                    r.children[2].0,
                    r.immediates[0],
                    place.unwrap_or(if is_labelled { RECEIVER_IS_OF_ONE_ROW } else { r.immediates[1] }),
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
                let first = self.targets.len() as u32 / SIZES[11];
                for target in &targets {
                    let arguments = self.list(target.args.iter().map(|v| v.0));
                    self.targets.extend([target.block.0, arguments[0], arguments[1]]);
                }
                let cases = self.list(cases.iter().flat_map(|&case| [case as u32, (case as u64 >> 32) as u32]));
                self.blocks.extend([parameters[0], parameters[1], ops[0], ops[1], kind, value.0, first, targets.len() as u32, cases[0], cases[1]]);
            }
            self.functions.extend([
                func.name.0,
                func.module.0,
                func.pos,
                func.kind as u32,
                func.flags as u32,
                captures[0],
                captures[1],
                func.this_declared.0,
                parameters[0],
                parameters[1],
                blocks,
                func.blocks.len() as u32,
                values,
                func.values.len() as u32,
                func.length as u32,
                func.result.0,
                func.place_of_text,
                func.end_of_text,
            ]);
        }
    }

    /// What `functions` has written counts from the start of these tables. They are put behind others, which are that long.
    fn put_behind(&mut self, words: u32, blocks: u32, values: u32, targets: u32) {
        for function in self.functions.chunks_exact_mut(SIZES[8] as usize) {
            function[5] += words;
            function[8] += words;
            function[10] += blocks;
            function[12] += values;
        }
        for block in self.blocks.chunks_exact_mut(SIZES[9] as usize) {
            block[0] += words;
            block[2] += words;
            block[6] += targets;
            block[8] += words;
        }
        for value in self.values.chunks_exact_mut(SIZES[10] as usize) {
            value[7] += words;
        }
        for target in self.targets.chunks_exact_mut(SIZES[11] as usize) {
            target[1] += words;
        }
    }
}

/// How many functions are written at a time. The number does not show in what is written.
const FUNCTIONS_OF_A_SLICE: usize = 256;

fn site_table(p: &Program) -> Vec<u32> {
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
    let mut sites = crate::audit::sites(p);
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

pub fn write(p: &Program, in_parallel: InParallel<'_>) -> Vec<u8> {
    let mut w = Writer::default();
    for i in 0..p.strs.len() {
        let bytes = p.strs.get(crate::id::StrId::new(i));
        w.strings.extend([w.bytes.len() as u32, bytes.len() as u32]);
        w.bytes.extend_from_slice(bytes);
    }
    for declared in &p.tys.list {
        let flags = u32::from(declared.any_object) | u32::from(declared.any_function) << 1 | u32::from(declared.ints.is_some()) << 2;
        let (least, most) = declared.ints.unwrap_or((0, 0));
        let first = w.parts.len() as u32 / SIZES[2];
        for part in &declared.parts {
            let (kind, index, arguments) = match part {
                Part::Class(shape) => (0, shape.0, [0, 0]),
                Part::Global(name, args) => (1, name.0, w.list(args.iter().map(|t| t.0))),
                Part::Array(element) => (2, NONE, w.list([element.0])),
            };
            w.parts.extend([kind, index, arguments[0], arguments[1]]);
        }
        w.declared.extend([declared.prims, flags, least as u32, (least as u64 >> 32) as u32, most as u32, (most as u64 >> 32) as u32, first, declared.parts.len() as u32]);
    }
    for layout in &p.layouts {
        let (fields, methods) = (w.fields.len() as u32 / SIZES[4], w.methods.len() as u32 / SIZES[5]);
        for field in &layout.fields {
            let literals = w.list(field.literals.iter().flat_map(|literal| match *literal {
                Literal::Str(text) => [0, text.0, 0],
                Literal::Num(value) => [1, value.to_bits() as u32, (value.to_bits() >> 32) as u32],
            }));
            w.fields.extend([field.name.0, field.declared.0, field.flags as u32, literals[0], literals[1], field.type_text.0, field.only_function.0, field.only_function_flags as u32]);
        }
        for method in &layout.methods {
            w.methods.extend([method.name.0, method.func.0, method.kind as u32, method.flags as u32, method.key]);
        }
        let members = w.list(layout.members.iter().map(|member| member.0));
        let members_by_fit = w.list(layout.members_by_fit.iter().map(|member| member.0));
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
            u32::from(layout.is_allocated) | u32::from(layout.may_be_frozen) << 1 | layout.class_flags | u32::from(layout.admits_foreign) << 7 | u32::from(layout.is_opened_for_the_log) << 11,
            members[0],
            members[1],
            members_by_fit[0],
            members_by_fit[1],
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
        w.variables.extend([global.name.0, global.module.0, global.declared.0, if global.initialization == crate::ir::Initialization::Lazy { crate::ir::Initialization::Undefined as u32 } else { global.initialization as u32 }, global.only_function.0, global.only_function_flags as u32]);
    }
    for module in &p.modules {
        w.modules.extend([module.path.0, module.init.0, module.display_path.0, w.bytes.len() as u32, module.line_table.len() as u32]);
        w.bytes.extend_from_slice(&module.line_table);
        w.modules.extend([w.bytes.len() as u32, module.printed.len() as u32]);
        w.bytes.extend_from_slice(&module.printed);
    }
    let mut slices: Vec<((usize, &[Func]), Writer)> = p.funcs.chunks(FUNCTIONS_OF_A_SLICE).enumerate().map(|(number, funcs)| ((number * FUNCTIONS_OF_A_SLICE, funcs), Writer::default())).collect();
    let none_is_marked: Vec<Vec<V>> = if p.marked_values.len() == p.funcs.len() { Vec::new() } else { vec![Vec::new(); p.funcs.len()] };
    let marked_values = if p.marked_values.len() == p.funcs.len() { &p.marked_values } else { &none_is_marked };
    for_each_mut(&mut slices, in_parallel, &|((first, funcs), slice)| slice.functions(funcs, *first, &p.accesses_of_one_row, marked_values, &p.known_places));
    let mut before = [w.words.len() as u32, 0, 0, 0];
    let mut slices: Vec<(Writer, [u32; 4])> = (slices.into_iter())
        .map(|(_, slice)| {
            let behind = before;
            let lengths = [slice.words.len() as u32, slice.blocks.len() as u32 / SIZES[9], slice.values.len() as u32 / SIZES[10], slice.targets.len() as u32 / SIZES[11]];
            before = [0, 1, 2, 3].map(|i| before[i] + lengths[i]);
            (slice, behind)
        })
        .collect();
    for_each_mut(&mut slices, in_parallel, &|(slice, [words, blocks, values, targets])| slice.put_behind(*words, *blocks, *values, *targets));

    let head = std::mem::take(&mut w.words);
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
    let table_of_sites = if p.logs_type_errors { site_table(p) } else { Vec::new() };
    let sites = list(&mut table_of_sites.into_iter());

    let number_of_bytes = w.bytes.len() as u32;
    while w.bytes.len() % 4 != 0 {
        w.bytes.push(0);
    }
    const HEADER_WORDS: usize = 6 + 14 * 2 + 16 + 12;
    let of_slices = |table: fn(&Writer) -> &[u32]| slices.iter().map(move |(slice, _)| table(slice));
    let tables: [(Vec<&[u32]>, u32); 13] = [
        (std::iter::once(&head[..]).chain(of_slices(|slice| &slice.words[..])).chain([&w.words[..]]).collect(), 1),
        (vec![&w.strings[..]], SIZES[0]),
        (vec![&w.declared[..]], SIZES[1]),
        (vec![&w.parts[..]], SIZES[2]),
        (vec![&w.shapes[..]], SIZES[3]),
        (vec![&w.fields[..]], SIZES[4]),
        (vec![&w.methods[..]], SIZES[5]),
        (vec![&w.variables[..]], SIZES[6]),
        (vec![&w.modules[..]], SIZES[7]),
        (of_slices(|slice| &slice.functions[..]).collect(), SIZES[8]),
        (of_slices(|slice| &slice.blocks[..]).collect(), SIZES[9]),
        (of_slices(|slice| &slice.values[..]).collect(), SIZES[10]),
        (of_slices(|slice| &slice.targets[..]).collect(), SIZES[11]),
    ];
    let mut header: Vec<u32> = vec![MAGIC, VERSION, 0, hash_of_opcode_names(), crate::builtins_generated::BUILTINS_HASH, if p.logs_type_errors { PROGRAM_LOGS_TYPE_ERRORS } else { 0 }];
    let mut offset = HEADER_WORDS * 4;
    header.extend([offset as u32, number_of_bytes]);
    offset += w.bytes.len();
    for (table, size) in &tables {
        let length: usize = table.iter().map(|part| part.len()).sum();
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
    header.extend(SIZES.iter().map(|words| words * 4));
    header[2] = offset as u32;
    debug_assert_eq!(header.len(), HEADER_WORDS);
    let mut out = Vec::with_capacity(offset);
    if cfg!(target_endian = "little") {
        const BYTES_OF_A_PIECE: usize = 1 << 20;
        fn bytes_of(words: &[u32]) -> &[u8] {
            // SAFETY: every byte of a `u32` is initialized, and a byte is aligned anywhere.
            unsafe { words.align_to::<u8>() }.1
        }
        let parts = [bytes_of(&header), &w.bytes[..]].into_iter().chain(tables.iter().flat_map(|(table, _)| table).map(|part| bytes_of(part)));
        let mut room = &mut out.spare_capacity_mut()[..offset];
        let mut pieces = Vec::new();
        for piece in parts.flat_map(|part| part.chunks(BYTES_OF_A_PIECE)) {
            let (here, behind) = room.split_at_mut(piece.len());
            pieces.push((here, piece));
            room = behind;
        }
        assert!(room.is_empty());
        for_each_mut(&mut pieces, in_parallel, &|(here, piece)| {
            here.write_copy_of_slice(piece);
        });
        // SAFETY: the pieces are all of the first `offset` bytes, and each has been written.
        unsafe { out.set_len(offset) };
        return out;
    }
    extend_with_words(&mut out, &header);
    out.extend_from_slice(&w.bytes);
    for part in tables.iter().flat_map(|(table, _)| table) {
        extend_with_words(&mut out, part);
    }
    out
}

/// Little-endian.
fn extend_with_words(out: &mut Vec<u8>, words: &[u32]) {
    if cfg!(target_endian = "little") {
        // SAFETY: every byte of a `u32` is initialized, and a byte is aligned anywhere.
        out.extend_from_slice(unsafe { words.align_to::<u8>() }.1);
    } else {
        out.extend(words.iter().flat_map(|word| word.to_le_bytes()));
    }
}

#[cfg(test)]
mod tests {
    use super::line_table;

    #[test]
    fn line_table_of_ascii() {
        assert_eq!(line_table(b"", &[0]), [1, 0]);
        assert_eq!(line_table(b"a\nbc\r\nd", &[0, 2, 6]), [3, 2, 4, 0]);
        let long = [&[b'x'; 199][..], b"\ny"].concat();
        assert_eq!(line_table(&long, &[0, 200]), [2, 0xC8, 0x01, 0]);
    }

    #[test]
    fn line_table_lists_what_is_not_ascii() {
        // Line 1 starts with a character of two bytes, line 2 with one of four.
        assert_eq!(line_table("a\n\u{e9}=1\n\u{1f600}x".as_bytes(), &[0, 2, 7]), [3, 2, 5, 2, 1, 1, 0, 1, 1, 2]);
        // Two of three bytes, after two bytes and after one.
        assert_eq!(line_table("ab\u{20ac}c\u{20ac}".as_bytes(), &[0]), [1, 1, 0, 2, 2 << 2 | 1, 1 << 2 | 1]);
        // The lines in between are not listed.
        assert_eq!(line_table("\u{e9}\n\n\n\u{e9}".as_bytes(), &[0, 3, 4, 5]), [4, 3, 1, 1, 2, 0, 1, 0, 3, 1, 0]);
    }
}
