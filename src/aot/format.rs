//! The program as one buffer of 32-bit words that the engine reads in place. This mirrors
//! Source/JavaScriptCore/aot/AOTTypedFormat.h of the engine: the order of the operations, of the sections and of the words of a
//! record is that of the header. The sizes of the records travel along, so that a difference is an error and not a wrong program.

use crate::declared::Part;
use crate::id::V;
use crate::ir::{BinOp, Def, Literal, Op, Prediction, Program, RelOp, Target, Term, UnOp, Why};

pub const MAGIC: u32 = 0x5249_5442;
pub const VERSION: u32 = 26;
pub const NONE: u32 = u32::MAX;
/// In the prediction of a value: the other bits number a function, which the value is expected to be a closure of, and not a type.
pub const PREDICTION_IS_CLOSURE: u32 = 1 << 31;
pub const PREDICTION_IS_BY_KEY: u32 = 1 << 30;
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
                Why::NonNull(_) => 2,
                Why::Claim => 3,
                Why::Flow => 4,
                Why::Upcast => 5,
                Why::Coerce => 6,
            };
            // The type is that of the value, but for `Why::Coerce`.
            let first = if let Why::NonNull(text) = asserted { text.0 } else { to.0 };
            (r.opcode, r.children[0], r.immediates) = (Opcode::Cast, *value, [first, why]);
        }
        Op::Caught => r.opcode = Opcode::CatchValue,
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
        Term::Throw { value, unwind } => (4, *value, unwind.iter().collect(), Vec::new()),
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

const SIZES: [u32; 12] = [2, 8, 4, 18, 8, 5, 6, 5, 16, 10, 11, 3];

impl Writer {
    /// The words as a list in the pool: where it starts and how long it is.
    fn list(&mut self, words: impl IntoIterator<Item = u32>) -> [u32; 2] {
        let start = self.words.len() as u32;
        self.words.extend(words);
        [start, self.words.len() as u32 - start]
    }
}

pub fn write(p: &Program) -> Vec<u8> {
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
        let specializations = w.list(layout.specializations.iter().map(|specialization| specialization.0));
        let static_fields = w.list(layout.static_fields.iter().flat_map(|&(name, variable)| [name.0, variable]));
        w.shapes.extend([
            layout.kind as u32,
            layout.name.0,
            layout.base.0,
            fields,
            layout.fields.len() as u32,
            methods,
            layout.methods.len() as u32,
            layout.constructor.0,
            u32::from(layout.is_allocated) | u32::from(layout.may_be_frozen) << 1 | layout.class_flags | u32::from(layout.admits_foreign) << 7,
            members[0],
            members[1],
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
        w.variables.extend([global.name.0, global.module.0, global.declared.0, global.initialization as u32, global.only_function.0, global.only_function_flags as u32]);
    }
    for module in &p.modules {
        w.modules.extend([module.path.0, module.init.0, module.display_path.0, w.bytes.len() as u32, module.line_table.len() as u32]);
        w.bytes.extend_from_slice(&module.line_table);
    }
    for func in &p.funcs {
        let parameters = w.list(func.params.iter().enumerate().map(|(i, t)| if t.is_some() && func.why_of_param(i) == Why::Cast { t.0 | PARAMETER_IS_ANNOTATED } else { t.0 }));
        let captures = w.list(func.captures.iter().map(|ty| ty.0));
        let (blocks, values) = (w.blocks.len() as u32 / SIZES[9], w.values.len() as u32 / SIZES[10]);
        for value in &func.values {
            let r = record(&value.def);
            let arguments = w.list(r.args.iter().map(|v| v.0));
            let prediction = match value.prediction {
                Prediction::None => NONE,
                Prediction::Ty(ty) | Prediction::Field(ty) => ty.0,
                Prediction::Closure(func) => PREDICTION_IS_CLOSURE | func.0,
                Prediction::ByKey(property) => PREDICTION_IS_BY_KEY | property.0,
            };
            w.values.extend([
                r.opcode as u32,
                value.pos,
                r.children[0].0,
                r.children[1].0,
                r.children[2].0,
                r.immediates[0],
                r.immediates[1],
                arguments[0],
                arguments[1],
                value.ty.0,
                prediction,
            ]);
        }
        for block in &func.blocks {
            let parameters = w.list(block.params.iter().map(|v| v.0));
            let ops = w.list(block.ops.iter().map(|v| v.0));
            let (kind, value, targets, cases) = end_of(block.term.as_ref().unwrap_or(&Term::Unreachable));
            let first = w.targets.len() as u32 / SIZES[11];
            for target in &targets {
                let arguments = w.list(target.args.iter().map(|v| v.0));
                w.targets.extend([target.block.0, arguments[0], arguments[1]]);
            }
            let cases = w.list(cases.iter().flat_map(|&case| [case as u32, (case as u64 >> 32) as u32]));
            w.blocks.extend([parameters[0], parameters[1], ops[0], ops[1], kind, value.0, first, targets.len() as u32, cases[0], cases[1]]);
        }
        w.functions.extend([
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
        ]);
    }

    let extended_globals = w.list(p.extended_globals.iter().map(|name| name.0));
    let prototype_property_names = w.list(p.prototype_property_names.iter().map(|name| name.0));
    let builtin_modules = w.list(p.builtin_modules.iter().flat_map(|&(id, func)| [id, func.0]));
    let builtin_functions = w.list(p.builtin_functions.iter().flat_map(|&(id, func, visibility)| [id, func.0, visibility]));
    let functions_by_key = w.list(p.functions_by_key.iter().flat_map(|&(property, key, func)| [property.0, key.0, func.0]));
    let entries = w.list(p.entries.iter().map(|func| func.0));

    let number_of_bytes = w.bytes.len() as u32;
    while w.bytes.len() % 4 != 0 {
        w.bytes.push(0);
    }
    const HEADER_WORDS: usize = 5 + 14 * 2 + 12 + 12;
    let tables: [(&[u32], u32); 13] = [
        (&w.words, 1),
        (&w.strings, SIZES[0]),
        (&w.declared, SIZES[1]),
        (&w.parts, SIZES[2]),
        (&w.shapes, SIZES[3]),
        (&w.fields, SIZES[4]),
        (&w.methods, SIZES[5]),
        (&w.variables, SIZES[6]),
        (&w.modules, SIZES[7]),
        (&w.functions, SIZES[8]),
        (&w.blocks, SIZES[9]),
        (&w.values, SIZES[10]),
        (&w.targets, SIZES[11]),
    ];
    let mut header: Vec<u32> = vec![MAGIC, VERSION, 0, hash_of_opcode_names(), crate::builtins_generated::BUILTINS_HASH];
    let mut offset = HEADER_WORDS * 4;
    header.extend([offset as u32, number_of_bytes]);
    offset += w.bytes.len();
    for (table, size) in &tables {
        header.extend([offset as u32, table.len() as u32 / size]);
        offset += table.len() * 4;
    }
    header.extend(extended_globals);
    header.extend(prototype_property_names);
    header.extend(builtin_modules);
    header.extend(builtin_functions);
    header.extend(functions_by_key);
    header.extend(entries);
    header.extend(SIZES.iter().map(|words| words * 4));
    header[2] = offset as u32;
    debug_assert_eq!(header.len(), HEADER_WORDS);
    let mut out = Vec::with_capacity(offset);
    out.extend(header.iter().flat_map(|word| word.to_le_bytes()));
    out.extend_from_slice(&w.bytes);
    for (table, _) in &tables {
        out.extend(table.iter().flat_map(|word| word.to_le_bytes()));
    }
    out
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
