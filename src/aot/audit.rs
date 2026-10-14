use crate::declared::{Declared, Part, prim};
use crate::format::record;
use crate::id::{BlockId, TyId, V};
use crate::ir::{BinOp, Def, Func, LayoutKind, Op, Program, Span, Term, UnOp, Why, func_flags};
use rustc_hash::FxHashMap;
use std::fmt::Write;

#[derive(Copy, Clone)]
pub struct Noted {
    pub start: u32,
    pub end: u32,
    pub step: i32,
    pub block: BlockId,
}

fn successors(func: &Func, block: usize) -> Vec<usize> {
    match &func.blocks[block].term {
        Some(Term::Jump(target)) => vec![target.block.idx()],
        Some(Term::Branch { then, otherwise, .. }) => vec![then.block.idx(), otherwise.block.idx()],
        Some(Term::Switch { cases, default, .. }) => cases.iter().map(|case| case.1.block.idx()).chain([default.block.idx()]).collect(),
        Some(Term::Invoke { normal, .. }) => vec![normal.block.idx()],
        Some(Term::Return(_) | Term::Throw { .. } | Term::Unreachable) | None => Vec::new(),
    }
}

struct PostDominators {
    parent: Vec<usize>,
    order: Vec<usize>,
}

const UNKNOWN: usize = usize::MAX;

impl PostDominators {
    fn of(func: &Func) -> PostDominators {
        let count = func.blocks.len();
        let exit = count;
        let following: Vec<Vec<usize>> = (0..count).map(|block| successors(func, block)).collect();
        let mut preceding: Vec<Vec<usize>> = vec![Vec::new(); count + 1];
        for (block, next) in following.iter().enumerate() {
            for &to in next {
                preceding[to].push(block);
            }
            if next.is_empty() {
                preceding[exit].push(block);
            }
        }
        let mut order = vec![UNKNOWN; count + 1];
        let mut visited: Vec<usize> = Vec::with_capacity(count + 1);
        let mut stack: Vec<(usize, usize)> = vec![(exit, 0)];
        let mut is_seen = vec![false; count + 1];
        is_seen[exit] = true;
        while let Some(&mut (block, ref mut at)) = stack.last_mut() {
            if let Some(&next) = preceding[block].get(*at) {
                *at += 1;
                if !is_seen[next] {
                    is_seen[next] = true;
                    stack.push((next, 0));
                }
            } else {
                order[block] = visited.len();
                visited.push(block);
                stack.pop();
            }
        }
        let mut parent = vec![UNKNOWN; count + 1];
        parent[exit] = exit;
        let mut has_changed = true;
        while has_changed {
            has_changed = false;
            for &block in visited.iter().rev().skip(1) {
                let mut found = UNKNOWN;
                let exits = [exit];
                let next: &[usize] = if following[block].is_empty() { &exits } else { &following[block] };
                for &to in next {
                    if parent[to] == UNKNOWN {
                        continue;
                    }
                    found = if found == UNKNOWN { to } else { PostDominators::meet(&parent, &order, found, to) };
                }
                if found != UNKNOWN && parent[block] != found {
                    parent[block] = found;
                    has_changed = true;
                }
            }
        }
        PostDominators { parent, order }
    }

    fn meet(parent: &[usize], order: &[usize], mut a: usize, mut b: usize) -> usize {
        while a != b {
            while order[a] < order[b] {
                a = parent[a];
            }
            while order[b] < order[a] {
                b = parent[b];
            }
        }
        a
    }

    fn is_always_reached_from(&self, later: usize, earlier: usize) -> bool {
        if self.parent[earlier] == UNKNOWN || self.parent[later] == UNKNOWN {
            return false;
        }
        let mut at = earlier;
        while self.order[at] < self.order[later] {
            at = self.parent[at];
        }
        at == later
    }
}

pub(crate) const RECEIVER: i32 = i32::MIN;
pub(crate) const STORED: i32 = i32::MIN + 1;
pub(crate) const READ_LATER: i32 = i32::MIN + 2;

pub(crate) fn settle(func: &Func, noted: &FxHashMap<V, Noted>) -> Vec<Span> {
    let mut made_in: Vec<u32> = vec![u32::MAX; func.values.len()];
    for (index, block) in func.blocks.iter().enumerate() {
        for &v in block.params.iter().chain(&block.ops) {
            made_in[v.idx()] = index as u32;
        }
    }
    let mut after: Option<PostDominators> = None;
    let mut spans: Vec<Span> = Vec::with_capacity(noted.len());
    for (&value, &span) in noted {
        if value.is_none() {
            spans.push(Span { value, start: span.start, end: span.end, step: span.step });
            continue;
        }
        if span.step == READ_LATER {
            spans.push(Span { value, start: span.start, end: span.end, step: 0 });
            continue;
        }
        let holds = match func.op(value) {
            Some(&Op::Coerce { to, why, .. }) if !matches!(why, Why::Upcast | Why::Forced) => Some(to),
            Some(Op::IterOpen(_)) => Some(TyId::NONE),
            _ => None,
        };
        let Some(to) = holds else {
            spans.push(Span { value, start: span.start, end: span.end, step: span.step });
            continue;
        };
        let here = made_in[value.idx()];
        if here == u32::MAX {
            continue;
        }
        let after = after.get_or_insert_with(|| PostDominators::of(func));
        if here as usize == span.block.idx() || after.is_always_reached_from(here as usize, span.block.idx()) {
            spans.push(Span { value, start: span.start, end: span.end, step: span.step });
            continue;
        }
        spans.extend(at_the_join(func, noted, value, to, here as usize));
    }
    let held_without_a_note = |value: V| match func.op(value) {
        Some(&Op::Coerce { value: held, to, why }) if !matches!(why, Why::Upcast | Why::Forced) && !noted.contains_key(&value) => Some((held, to, why)),
        _ => None,
    };
    let all = || func.blocks.iter().flat_map(|block| &block.ops).copied();
    let held_again: FxHashMap<V, V> = all().filter_map(|value| Some((held_without_a_note(value)?.0, value))).collect();
    for claim in all().filter(|&value| matches!(held_without_a_note(value), Some((_, _, Why::Claim)))) {
        let mut chain = vec![claim];
        while let Some(&next) = held_again.get(&chain[chain.len() - 1]) {
            chain.push(next);
        }
        let last = chain[chain.len() - 1];
        if let Some((_, to, _)) = held_without_a_note(last)
            && let Some(span) = at_the_join(func, noted, last, to, made_in[last.idx()] as usize)
        {
            spans.extend(chain.into_iter().filter(|&value| held_without_a_note(value).is_some_and(|held| held.1 == to)).map(|value| Span { value, ..span }));
        }
    }
    spans.sort_unstable_by_key(|span| span.value);
    spans.dedup_by_key(|span| span.value);
    spans
}

fn at_the_join(func: &Func, noted: &FxHashMap<V, Noted>, value: V, to: TyId, mut at: usize) -> Option<Span> {
    let joined = loop {
        match &func.blocks[at].term {
            Some(Term::Invoke { normal, .. }) if !normal.args.contains(&value) => at = normal.block.idx(),
            Some(Term::Jump(target) | Term::Invoke { normal: target, .. }) => break target.args.iter().position(|&arg| arg == value).map(|index| func.blocks[target.block.idx()].params[index])?,
            _ => return None,
        }
    };
    let whole = noted.get(&joined).filter(|_| func.ty(joined) == to)?;
    let step = if whole.step == READ_LATER { 0 } else { whole.step };
    Some(Span { value, start: whole.start, end: whole.end, step })
}

fn quoted(out: &mut String, bytes: &[u8]) {
    out.push('"');
    for c in String::from_utf8_lossy(bytes).chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

pub fn quoted_text(bytes: &[u8]) -> String {
    let mut out = String::new();
    quoted(&mut out, bytes);
    out
}

fn append_member(result: &mut String, has: bool, name: &str) {
    if has {
        if !result.is_empty() {
            result.push_str(" | ");
        }
        result.push_str(name);
    }
}

fn append_primitives(result: &mut String, prims: u32) {
    let has_both = prims & prim::NULLISH == prim::NULLISH;
    let prims = if has_both && (!result.is_empty() || prims & !prim::NULLISH != 0) { prims & !prim::NULLISH } else { prims };
    append_member(result, prims & prim::BOOLEAN == prim::BOOLEAN, "boolean");
    append_member(result, prims & prim::BOOLEAN == prim::TRUE, "true");
    append_member(result, prims & prim::BOOLEAN == prim::FALSE, "false");
    append_member(result, prims & prim::NUMBER != 0, "number");
    append_member(result, prims & prim::STRING != 0, "string");
    append_member(result, prims & prim::SYMBOL != 0, "symbol");
    append_member(result, prims & prim::BIGINT != 0, "bigint");
    append_member(result, prims & prim::UNDEFINED != 0, "undefined");
    append_member(result, prims & prim::NULL != 0, "null");
    let is_empty = result.is_empty();
    append_member(result, is_empty, "never");
}

pub fn name_of_layout(program: &Program, layout: crate::id::LayoutId) -> String {
    let layout = &program.layouts[layout.idx()];
    if layout.name.is_some() && !program.strs.get(layout.name).is_empty() {
        return String::from_utf8_lossy(program.strs.get(layout.name)).into_owned();
    }
    let mut result = String::from("{");
    for (i, field) in layout.fields.iter().take(4).enumerate() {
        result.push_str(if i == 0 { " " } else { ", " });
        result.push_str(&String::from_utf8_lossy(program.strs.get(field.name)));
    }
    result.push_str(if layout.fields.len() > 4 { ", ... }" } else { " }" });
    result
}

pub fn describe(program: &Program, ty: TyId) -> String {
    let declared = program.tys.get(ty);
    if declared.any_object && declared.prims & prim::ALL == prim::ALL {
        return "any".to_owned();
    }
    let mut result = String::new();
    for part in &declared.parts {
        if let Part::Class(layout) = part {
            append_member(&mut result, true, &name_of_layout(program, *layout));
        }
    }
    for part in &declared.parts {
        match part {
            Part::Class(_) => {}
            Part::Array(elements) => {
                let element = if elements.is_some() { describe(program, *elements) } else { "any".to_owned() };
                let text = if element.contains(" | ") { format!("({element})[]") } else { format!("{element}[]") };
                append_member(&mut result, true, &text);
            }
            Part::Global(name, _) => append_member(&mut result, true, &String::from_utf8_lossy(program.strs.get(*name))),
        }
    }
    append_member(&mut result, declared.any_object, "object");
    append_member(&mut result, declared.any_function && !declared.any_object, "Function");
    if let Some((least, most)) = declared.ints.filter(|_| declared.prims & prim::NUMBER == 0) {
        let text = if least == most { format!("{least}") } else { format!("integer {least}..{most}") };
        append_member(&mut result, true, &text);
    }
    append_primitives(&mut result, declared.prims);
    result
}

fn may_hold_what_is_not_laid_out(program: &Program, declared: &Declared, is_linked: bool) -> bool {
    !is_linked
        || declared.any_object
        || declared.any_function
        || declared.prims & !prim::NULLISH != 0
        || declared.parts.iter().any(|part| match part {
            Part::Class(layout) => {
                let layout = &program.layouts[layout.idx()];
                layout.admits_foreign || layout.kind == LayoutKind::Environment
            }
            Part::Global(..) | Part::Array(_) => true,
        })
}

fn is_number_or_nil_or_boolean(declared: &Declared) -> bool {
    !declared.has_objects() && declared.prims & (prim::STRING | prim::SYMBOL | prim::BIGINT) == 0
}

fn is_vouched_by_operands(program: &Program, func: &Func, op: &Op, yields: &Declared) -> bool {
    let of = |v: V| program.tys.get(func.ty(v));
    let takes_numbers = yields.prims & prim::NUMBER != 0 || yields.ints.is_some();
    match *op {
        Op::Binary { op: BinOp::Add, a, b } => {
            let (a, b) = (of(a), of(b));
            let is_string = |declared: &Declared| !declared.has_objects() && declared.ints.is_none() && declared.prims == prim::STRING;
            if is_number_or_nil_or_boolean(a) && is_number_or_nil_or_boolean(b) {
                return takes_numbers;
            }
            yields.prims & prim::STRING != 0 && (is_string(a) || is_string(b)) && !a.has_objects() && !b.has_objects() && (a.prims | b.prims) & prim::SYMBOL == 0
        }
        Op::Binary { a, b, .. } => takes_numbers && is_number_or_nil_or_boolean(of(a)) && is_number_or_nil_or_boolean(of(b)),
        Op::Unary { op: UnOp::Neg | UnOp::ToNumeric | UnOp::BitNot | UnOp::ToNumber, a } => takes_numbers && is_number_or_nil_or_boolean(of(a)),
        _ => true,
    }
}

struct Held {
    is_known_by_the_link_alone: bool,
    what: String,
    to: TyId,
    result: TyId,
    text: crate::id::StrId,
    from: V,
}

fn held(program: &Program, func: &Func, v: V, is_linked: bool) -> Option<Held> {
    let value = &func.values[v.idx()];
    let Def::Op(op) = &value.def else { return None };
    let anything = program.tys.anything;
    let none = crate::id::StrId::NONE;
    if let Op::Coerce { value: from, to, why } = *op {
        let (what, text) = match why {
            Why::Upcast | Why::Forced => return None,
            Why::Store => ("Store", none),
            Why::Cast | Why::CastFresh => ("As", none),
            Why::NonNull(text) => ("NonNull", text),
            Why::Claim => ("Claim", none),
            Why::Flow => ("Flow", none),
            Why::Coerce | Why::CoerceFreshGraph => ("Coerce", none),
        };
        return Some(Held { is_known_by_the_link_alone: false, what: what.to_owned(), to, result: value.ty, text, from });
    }
    if let Op::IterOpen(iterated) = *op {
        let ty = func.ty(iterated);
        let declared = program.tys.get(ty);
        let is_array = !declared.parts.is_empty() && !declared.any_object && declared.parts.iter().all(|part| matches!(part, Part::Array(_)));
        return is_array.then(|| Held { is_known_by_the_link_alone: false, what: "IteratorOpen".to_owned(), to: ty, result: ty, text: none, from: V::NONE });
    }
    if value.ty.is_none() || value.ty == anything || program.tys.get(value.ty).is_never() {
        return None;
    }
    let is_held = match op {
        Op::PropGet { obj, name } if program.strs.get(*name) == b"length" && {
            let read_of = program.tys.get(func.ty(*obj));
            read_of.prims & !(prim::STRING | prim::NULLISH) == 0 && read_of.ints.is_none() && !read_of.any_object && !read_of.any_function && read_of.parts.iter().all(|part| matches!(part, Part::Array(_)))
        } =>
        {
            false
        }
        Op::PropGet { obj, .. } | Op::ElemGet { obj, .. } => may_hold_what_is_not_laid_out(program, program.tys.get(func.ty(*obj)), is_linked),
        Op::Call { .. } | Op::CallMethod { .. } | Op::Construct { .. } | Op::Await(_) | Op::Yield(_) | Op::Operation { .. } | Op::IterGet { .. } | Op::Caught | Op::FreeGet { is_typeof: false, .. } => true,
        Op::Binary { .. } | Op::Unary { .. } => !is_vouched_by_operands(program, func, op, program.tys.get(value.ty)),
        _ => false,
    };
    let is_known_by_the_link_alone = !is_linked && matches!(op, Op::PropGet { obj, .. } | Op::ElemGet { obj, .. } if !may_hold_what_is_not_laid_out(program, program.tys.get(func.ty(*obj)), true));
    is_held.then(|| Held { is_known_by_the_link_alone, what: format!("{:?}", record(&value.def).opcode), to: value.ty, result: value.ty, text: none, from: V::NONE })
}

pub struct Group {
    pub start: u32,
    pub end: u32,
    pub step: i32,
    pub passes: u32,
    pub least: i32,
    pub most: i32,
    pub steps: String,
}

pub struct Parameter {
    pub function: u32,
    pub index: u32,
    pub start: u32,
    pub end: u32,
    pub body: (u32, u32),
    pub passes: u32,
    pub least: i32,
    pub most: i32,
    pub step: String,
}

pub struct Module {
    pub path: Vec<u8>,
    pub length_of_text: Option<usize>,
    pub groups: Vec<Group>,
    pub parameters: Vec<Parameter>,
    pub without_span: Vec<String>,
}

pub mod class {
    pub const OBJECT: u32 = 1 << 8;
    pub const FUNCTION: u32 = 1 << 9;
    pub const ALL: u32 = (1 << 10) - 1;
}

fn is_closed(program: &Program, layout: crate::id::LayoutId) -> bool {
    let described = &program.layouts[layout.idx()];
    let is_named_class = |layout: &crate::ir::Layout| layout.kind == LayoutKind::Instance && layout.name.is_some() && !program.strs.get(layout.name).is_empty() && layout.class_flags & crate::ir::class_flags::IS_LAID_OUT != 0;
    is_named_class(described) && !described.admits_foreign && !described.members.is_empty() && described.members.iter().all(|member| is_named_class(&program.layouts[member.idx()]))
}

fn passes(program: &Program, declared: &Declared) -> u32 {
    let is_any_object_taken = declared.any_object || declared.parts.iter().any(|part| matches!(part, Part::Class(layout) if !is_closed(program, *layout)));
    declared.prims
        | if is_any_object_taken { class::OBJECT } else { 0 }
        | if declared.any_object || declared.any_function || declared.parts.iter().any(|part| !matches!(part, Part::Array(_))) { class::FUNCTION } else { 0 }
}

fn write_type(program: &Program, out: &mut String, ty: TyId, depth: u32) {
    let declared = program.tys.get(ty);
    let _ = write!(out, "{{\"p\":{},\"o\":{},\"fn\":{}", declared.prims, declared.any_object, declared.any_function);
    if let Some((least, most)) = declared.ints {
        let _ = write!(out, ",\"i\":[{least},{most}]");
    }
    out.push_str(",\"parts\":[");
    for (i, part) in declared.parts.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        match part {
            Part::Class(layout) => {
                let described = &program.layouts[layout.idx()];
                let _ = write!(out, "{{\"k\":\"class\",\"instance\":{},\"foreign\":{},\"name\":", described.kind == LayoutKind::Instance, described.admits_foreign);
                quoted(out, name_of_layout(program, *layout).as_bytes());
                if is_closed(program, *layout) {
                    out.push_str(",\"members\":[");
                    for (i, member) in described.members.iter().enumerate() {
                        if i > 0 {
                            out.push(',');
                        }
                        quoted(out, program.strs.get(program.layouts[member.idx()].name));
                    }
                    out.push(']');
                }
                out.push('}');
            }
            Part::Global(name, _) => {
                out.push_str("{\"k\":\"global\",\"name\":");
                quoted(out, program.strs.get(*name));
                out.push('}');
            }
            Part::Array(elements) => {
                out.push_str("{\"k\":\"array\"");
                if elements.is_some() && depth < 2 {
                    out.push_str(",\"of\":");
                    write_type(program, out, *elements, depth + 1);
                }
                out.push('}');
            }
        }
    }
    out.push_str("],\"t\":");
    quoted(out, describe(program, ty).as_bytes());
    out.push('}');
}

pub fn id_of(shown_path: &[u8], line: usize, column: usize, kind: &str, ordinal: usize) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for &byte in shown_path.iter().chain(format!(":{line}:{column}:{kind}:{ordinal}").as_bytes()) {
        hash = (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3);
    }
    format!("{:012x}", (hash >> 48) ^ (hash & 0xffff_ffff_ffff))
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Enters {
    Argument,
    Field,
    Return,
    Variable,
}

fn places_entered(program: &Program, func: &Func) -> FxHashMap<V, Enters> {
    let mut entered: FxHashMap<V, Enters> = FxHashMap::default();
    for block in &func.blocks {
        for &v in &block.ops {
            match func.op(v) {
                Some(Op::CallDirect { args, .. } | Op::Call { args, .. } | Op::CallMethod { args, .. } | Op::Construct { args, .. }) => {
                    for &arg in args {
                        entered.entry(arg).or_insert(Enters::Argument);
                    }
                }
                Some(&(Op::PropSet { value, .. } | Op::ElemSet { value, .. })) => {
                    entered.entry(value).or_insert(Enters::Field);
                }
                Some(&Op::FieldSet { value, layout, .. }) => {
                    entered.entry(value).or_insert(if program.layouts[layout.idx()].kind == LayoutKind::Environment { Enters::Variable } else { Enters::Field });
                }
                Some(Op::Operation { name, args }) if program.strs.get(*name) == b"Initialize" => {
                    for &arg in args {
                        entered.entry(arg).or_insert(Enters::Field);
                    }
                }
                _ => {}
            }
        }
        if let Some(Term::Return(value)) = block.term {
            entered.entry(value).or_insert(Enters::Return);
        }
    }
    entered
}

fn calls_entered(program: &Program, func: &Func) -> FxHashMap<V, (u32, usize)> {
    let mut entered: FxHashMap<V, (u32, usize)> = FxHashMap::default();
    for &v in func.blocks.iter().flat_map(|block| &block.ops) {
        if let Some(Op::CallDirect { func: callee, args }) = func.op(v) {
            let Some(callee) = program.funcs.get(callee.idx()).filter(|callee| callee.module.is_some()) else { continue };
            let first = callee.captures.len() + usize::from(callee.has(func_flags::HAS_THIS));
            for (index, &arg) in args.iter().enumerate().skip(first) {
                entered.entry(arg).or_insert((func.values[v.idx()].pos, index - first));
            }
        }
    }
    entered
}

fn members_entered(program: &Program, func: &Func) -> FxHashMap<V, String> {
    let mut entered: FxHashMap<V, String> = FxHashMap::default();
    let member = |layout: crate::id::LayoutId, name: &[u8]| format!("{}.{}", name_of_layout(program, layout), String::from_utf8_lossy(name));
    for &v in func.blocks.iter().flat_map(|block| &block.ops) {
        match func.op(v) {
            Some(&Op::FieldSet { value, layout, field, .. }) if program.layouts[layout.idx()].kind != LayoutKind::Environment => {
                if let Some(field) = program.layouts[layout.idx()].fields.get(field as usize) {
                    entered.entry(value).or_insert_with(|| member(layout, program.strs.get(field.name)));
                }
            }
            Some(&Op::PropSet { obj, name, value }) => {
                if let [Part::Class(layout)] = program.tys.get(func.ty(obj)).parts[..]
                    && program.layouts[layout.idx()].fields.iter().any(|field| field.name == name)
                {
                    entered.entry(value).or_insert_with(|| member(layout, program.strs.get(name)));
                }
            }
            _ => {}
        }
    }
    entered
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub enum Kind {
    AsConvert,
    AsRefuse,
    AsLateUse,
    NonNull,
    Narrowing,
    ReadProperty,
    ReadElement,
    CallResult,
    AwaitResult,
    IterateValue,
    ArithmeticResult,
    Int32Range,
    EnterArgument,
    EnterField,
    EnterReturn,
    EnterVariable,
    EnterFunction,
    ArrayNotPlain,
    FieldDelete,
    FieldStoreUntyped,
    FieldRedefine,
    ObjectSetPrototype,
    ClassPrototypeWrite,
    Made,
}

impl Kind {
    pub const ALL: [Kind; 24] = [Kind::AsConvert, Kind::AsRefuse, Kind::AsLateUse, Kind::NonNull, Kind::Narrowing, Kind::ReadProperty, Kind::ReadElement, Kind::CallResult, Kind::AwaitResult, Kind::IterateValue, Kind::ArithmeticResult, Kind::Int32Range, Kind::EnterArgument, Kind::EnterField, Kind::EnterReturn, Kind::EnterVariable, Kind::EnterFunction, Kind::ArrayNotPlain, Kind::FieldDelete, Kind::FieldStoreUntyped, Kind::FieldRedefine, Kind::ObjectSetPrototype, Kind::ClassPrototypeWrite, Kind::Made];

    pub fn as_str(self) -> &'static str {
        match self {
            Kind::AsConvert => "as-convert",
            Kind::AsRefuse => "as-refuse",
            Kind::AsLateUse => "as-late-use",
            Kind::NonNull => "non-null",
            Kind::Narrowing => "narrowing",
            Kind::ReadProperty => "read-property",
            Kind::ReadElement => "read-element",
            Kind::CallResult => "call-result",
            Kind::AwaitResult => "await-result",
            Kind::IterateValue => "iterate-value",
            Kind::ArithmeticResult => "arithmetic-result",
            Kind::Int32Range => "int32-range",
            Kind::EnterArgument => "enter-argument",
            Kind::EnterField => "enter-field",
            Kind::EnterReturn => "enter-return",
            Kind::EnterVariable => "enter-variable",
            Kind::EnterFunction => "enter-function",
            Kind::ArrayNotPlain => "array-not-plain",
            Kind::FieldDelete => "field-delete",
            Kind::FieldStoreUntyped => "field-store-untyped",
            Kind::FieldRedefine => "field-redefine",
            Kind::ObjectSetPrototype => "object-set-prototype",
            Kind::ClassPrototypeWrite => "class-prototype-write",
            Kind::Made => "made",
        }
    }
}

pub struct Site {
    pub module: u32,
    pub line: u32,
    pub column: u32,
    pub kind: Kind,
    pub ordinal: u32,
    pub what: String,
}

#[derive(Default)]
struct Numbers {
    given: FxHashMap<(usize, u32, Kind, String), u32>,
    next: FxHashMap<(usize, u32, Kind), u32>,
    sites: Vec<Site>,
}

impl Numbers {
    fn ordinal(&mut self, module: usize, pos: u32, (line, column): (usize, usize), kind: Kind, what: &str, rest: &str, fixed: Option<u32>) -> u32 {
        if let Some(&given) = self.given.get(&(module, pos, kind, [what, rest].concat())) {
            return given;
        }
        let next = self.next.entry((module, pos, kind)).or_insert(0);
        let ordinal = fixed.unwrap_or(*next);
        *next += 1;
        self.given.insert((module, pos, kind, [what, rest].concat()), ordinal);
        if kind != Kind::Made {
            self.sites.push(Site { module: module as u32, line: line as u32, column: column as u32, kind, ordinal, what: what.to_owned() });
        }
        ordinal
    }
}

fn before_casts(func: &Func, mut v: V) -> V {
    while let Some(&Op::Coerce { value, why, .. }) = func.op(v)
        && why != Why::Coerce
    {
        v = value;
    }
    v
}

fn kind_of_result(op: Option<&Op>) -> Kind {
    match op {
        Some(Op::PropGet { .. }) => Kind::ReadProperty,
        Some(Op::ElemGet { .. }) => Kind::ReadElement,
        Some(Op::Await(_)) => Kind::AwaitResult,
        Some(Op::IterGet { .. } | Op::Yield(_)) => Kind::IterateValue,
        Some(Op::Coerce { why: Why::Coerce | Why::CoerceFreshGraph, .. }) => Kind::AsLateUse,
        Some(Op::Binary { .. } | Op::Unary { .. }) => Kind::ArithmeticResult,
        _ => Kind::CallResult,
    }
}

fn kind_of(program: &Program, func: &Func, v: V, entered: &FxHashMap<V, Enters>) -> Kind {
    let Some(&Op::Coerce { value, to, why }) = func.op(v) else {
        return if matches!(func.op(v), Some(Op::IterOpen(_))) { Kind::ArrayNotPlain } else { kind_of_result(func.op(v)) };
    };
    let takes_integers_alone = program.tys.get(to).ints.is_some() && program.tys.get(to).prims & prim::NUMBER == 0;
    match why {
        Why::Coerce | Why::CoerceFreshGraph => Kind::AsConvert,
        Why::NonNull(_) => Kind::NonNull,
        Why::Flow => Kind::Narrowing,
        Why::Claim => kind_of_result(func.op(before_casts(func, value))),
        Why::Cast | Why::CastFresh | Why::Store if takes_integers_alone => Kind::Int32Range,
        _ => match entered.get(&v) {
            Some(Enters::Argument) => Kind::EnterArgument,
            Some(Enters::Field) => Kind::EnterField,
            Some(Enters::Return) => Kind::EnterReturn,
            Some(Enters::Variable) | None => Kind::EnterVariable,
        },
    }
}

fn conversions_behind(func: &Func, v: V) -> Vec<u32> {
    let mut operands: Vec<V> = Vec::new();
    match func.op(v) {
        Some(&Op::Binary { a, b, .. }) => operands.extend([a, b]),
        Some(&(Op::Unary { a, .. } | Op::PropGet { obj: a, .. } | Op::CallMethod { obj: a, .. })) => operands.push(a),
        Some(&Op::ElemGet { obj, key }) => operands.extend([obj, key]),
        _ => {}
    }
    let mut found = Vec::new();
    for mut operand in operands {
        while let Some(&Op::Coerce { value, why, .. }) = func.op(operand) {
            if matches!(why, Why::Coerce | Why::CoerceFreshGraph) {
                found.push(func.values[operand.idx()].pos);
            }
            operand = value;
        }
    }
    found
}

pub fn may_give_up(program: &Program, layout: crate::id::LayoutId) -> bool {
    let described = &program.layouts[layout.idx()];
    described.kind == LayoutKind::Record
        && described.is_allocated
        && described.admits_foreign
        && !program.layouts.iter().any(|view| !view.admits_foreign && view.members.contains(&layout))
}

fn keeps_its_fields(program: &Program, layout: crate::id::LayoutId) -> bool {
    let described = &program.layouts[layout.idx()];
    match described.kind {
        LayoutKind::Instance => described.class_flags & crate::ir::class_flags::IS_LAID_OUT != 0 && described.is_allocated,
        LayoutKind::Record => described.is_allocated && !may_give_up(program, layout),
        _ => false,
    }
}

fn text_of_shape(program: &Program, layout: crate::id::LayoutId) -> String {
    let described = &program.layouts[layout.idx()];
    let mut text = String::from("{\"name\":");
    quoted(&mut text, name_of_layout(program, layout).as_bytes());
    text.push_str(",\"fields\":{");
    for (i, field) in described.fields.iter().filter(|field| field.flags & crate::ir::field_flags::METHOD == 0).enumerate() {
        if i > 0 {
            text.push(',');
        }
        quoted(&mut text, program.strs.get(field.name));
        let _ = write!(text, ":{{\"optional\":{},\"to\":", field.flags & crate::ir::field_flags::OPTIONAL != 0);
        write_type(program, &mut text, if field.declared.is_some() { field.declared } else { program.tys.anything }, 0);
        text.push('}');
    }
    text.push_str("}}");
    text
}

fn key_of_shape(program: &Program, layout: crate::id::LayoutId) -> String {
    let described = &program.layouts[layout.idx()];
    match described.kind {
        LayoutKind::Instance => format!("class {}", String::from_utf8_lossy(program.strs.get(described.name))),
        _ => format!("record {}", id_of(text_of_shape(program, layout).as_bytes(), 0, 0, "", 0)),
    }
}

pub fn shapes(program: &Program) -> Vec<(String, String)> {
    let mut found: Vec<(String, String)> = Vec::new();
    for index in 0..program.layouts.len() {
        let layout = crate::id::LayoutId::new(index);
        if !keeps_its_fields(program, layout) {
            continue;
        }
        let described = &program.layouts[index];
        if described.kind == LayoutKind::Instance && (described.name.is_none() || program.strs.get(described.name).is_empty()) {
            continue;
        }
        let text = text_of_shape(program, layout);
        let key = key_of_shape(program, layout);
        match found.iter_mut().find(|known| known.0 == key) {
            Some(known) if known.1 != text => known.1 = String::from("null"),
            Some(_) => {}
            None => found.push((key, text)),
        }
    }
    found
}

struct Rule {
    kind: Kind,
    what: &'static str,
    rest: String,
}

fn is_function_of_object(program: &Program, func: &Func, v: V) -> Option<&'static str> {
    let (holder, name) = match func.op(v)? {
        Op::CallMethod { obj, name, .. } => (*obj, *name),
        Op::Call { callee, .. } => match func.op(*callee)? {
            Op::PropGet { obj, name } => (*obj, *name),
            _ => return None,
        },
        _ => return None,
    };
    let Some(&Op::FreeGet { name: global, .. }) = func.op(holder) else { return None };
    if program.strs.get(global) != b"Object" {
        return None;
    }
    ["setPrototypeOf", "defineProperty", "defineProperties", "assign"].into_iter().find(|known| known.as_bytes() == program.strs.get(name))
}

fn rules(program: &Program, func: &Func, v: V, spans: &FxHashMap<V, Span>, operands: &FxHashMap<(V, i32), Span>, is_linked: bool) -> Vec<(Rule, Option<Span>, u32)> {
    let objects_alone = class::ALL & !(class::OBJECT | class::FUNCTION);
    let is_seen_through = |obj: V| {
        let declared = program.tys.get(func.ty(obj));
        !declared.any_object && !declared.parts.is_empty()
    };
    let named = |name: crate::id::StrId| {
        let mut rest = String::from(",\"name\":");
        quoted(&mut rest, program.strs.get(name));
        rest
    };
    let suspends_within = |span: &Span| func.blocks.iter().flat_map(|block| &block.ops).any(|&other| matches!(func.op(other), Some(Op::Await(_) | Op::Yield(_))) && (span.start..span.end).contains(&func.values[other.idx()].pos));
    let mut found = Vec::new();
    match func.op(v) {
        Some(&Op::New(layout)) if is_linked && program.layouts[layout.idx()].kind == LayoutKind::Record && keeps_its_fields(program, layout) => {
            let mut rest = String::from(",\"shape\":");
            quoted(&mut rest, key_of_shape(program, layout).as_bytes());
            found.push((Rule { kind: Kind::Made, what: "NewObjectWithShape", rest }, spans.get(&v).copied(), objects_alone));
        }
        Some(&Op::PropDelete { obj, name }) if !is_seen_through(obj) => {
            found.push((Rule { kind: Kind::FieldDelete, what: "DeleteById", rest: named(name) }, operands.get(&(v, RECEIVER)).copied(), objects_alone));
        }
        Some(&Op::PropSet { obj, name, .. }) if !is_seen_through(obj) => {
            let pair = match (operands.get(&(v, RECEIVER)), operands.get(&(v, STORED))) {
                (Some(&receiver), Some(&stored)) if receiver.end <= stored.start && !suspends_within(&stored) => Some((receiver, stored)),
                _ => None,
            };
            let of_pair = pair.map_or_else(String::new, |(receiver, stored)| format!(",\"pair\":\"{}:{}\"", receiver.start, stored.end));
            found.push((Rule { kind: Kind::ClassPrototypeWrite, what: "PutById", rest: named(name) + &of_pair + ",\"receives\":true" }, pair.map(|pair| pair.0), objects_alone));
            found.push((Rule { kind: Kind::FieldStoreUntyped, what: "PutById", rest: named(name) + &of_pair + ",\"stores\":true" }, pair.map(|pair| pair.1), 0));
        }
        Some(Op::Call { .. } | Op::CallMethod { .. }) => match is_function_of_object(program, func, v) {
            Some("setPrototypeOf") => found.push((Rule { kind: Kind::ObjectSetPrototype, what: "Call", rest: String::new() }, operands.get(&(v, RECEIVER)).copied(), objects_alone)),
            Some(name) => {
                let kind = if name == "assign" { Kind::FieldStoreUntyped } else { Kind::FieldRedefine };
                found.push((Rule { kind, what: "Call", rest: String::from(",\"validates\":true") }, spans.get(&v).copied(), objects_alone));
            }
            None => {}
        },
        _ => {}
    }
    found
}

struct Lines {
    starts: Vec<u32>,
    wide: FxHashMap<u32, Vec<(u32, u32)>>,
}

impl Lines {
    fn read(table: &[u8]) -> Option<Lines> {
        let mut at = 0;
        let mut number = || {
            let (mut value, mut shift) = (0u32, 0);
            loop {
                let byte = *table.get(at)?;
                at += 1;
                value |= u32::from(byte & 0x7F) << shift;
                if byte & 0x80 == 0 {
                    return Some(value);
                }
                shift += 7;
            }
        };
        let mut starts = vec![0u32];
        for _ in 1..number()? {
            starts.push(starts[starts.len() - 1] + number()?);
        }
        let mut wide: FxHashMap<u32, Vec<(u32, u32)>> = FxHashMap::default();
        let mut line = 0;
        for _ in 0..number()? {
            line += number()?;
            let (mut characters, mut end) = (Vec::new(), 0);
            for _ in 0..number()? {
                let character = number()?;
                let (start, length) = (end + (character >> 2), (character & 3) + 2);
                characters.push((start, length));
                end = start + length;
            }
            wide.insert(line, characters);
        }
        Some(Lines { starts, wide })
    }

    fn line_and_column(&self, pos: u32) -> (usize, usize) {
        let line = self.starts.partition_point(|&start| start <= pos).max(1);
        let bytes = pos - self.starts[line - 1];
        let saved: u32 = self.wide.get(&(line as u32 - 1)).map_or(0, |characters| characters.iter().take_while(|character| character.0 < bytes).map(|&(_, length)| length - if length == 4 { 2 } else { 1 }).sum());
        (line, (bytes - saved) as usize + 1)
    }
}

struct Chain {
    start: u32,
    end: u32,
    step: i32,
    passes: u32,
    whole_numbers: Option<(i64, i64)>,
    steps: Vec<(V, String)>,
}

const EVERY_INT32: (i64, i64) = (i32::MIN as i64, i32::MAX as i64);

fn whole_numbers_within(so_far: Option<(i64, i64)>, declared: &Declared) -> Option<(i64, i64)> {
    let (least, most) = so_far?;
    match declared.ints {
        _ if declared.prims & prim::NUMBER != 0 => Some((least, most)),
        Some(within) => Some((least.max(within.0), most.min(within.1))),
        None => None,
    }
}

fn as_int32s(whole_numbers: Option<(i64, i64)>) -> (i32, i32) {
    match whole_numbers {
        Some((least, most)) if least <= most => (least as i32, most as i32),
        _ => (1, 0),
    }
}

pub fn table<'t>(program: &Program, is_linked: bool, text_of: &dyn Fn(&[u8]) -> Option<&'t [u8]>) -> Vec<Module> {
    walk(program, is_linked, text_of).0
}

pub fn sites(program: &Program) -> Vec<Site> {
    walk(program, true, &|_| None).1
}

fn walk<'t>(program: &Program, is_linked: bool, text_of: &dyn Fn(&[u8]) -> Option<&'t [u8]>) -> (Vec<Module>, Vec<Site>) {
    let lines: Vec<Option<Lines>> = program.modules.iter().map(|module| Lines::read(&module.line_table)).collect();
    let mut numbers = Numbers::default();
    let mut chains_by_module: Vec<Vec<Chain>> = program.modules.iter().map(|_| Vec::new()).collect();
    let mut modules: Vec<Module> = (program.modules.iter())
        .map(|module| Module { path: program.strs.get(module.display_path).to_vec(), length_of_text: text_of(program.strs.get(module.display_path)).map(<[u8]>::len), groups: Vec::new(), parameters: Vec::new(), without_span: Vec::new() })
        .collect();
    for func in &program.funcs {
        if func.module.is_none() || func.blocks.is_empty() || !func.has(func_flags::IS_TYPED) || func.has(func_flags::IS_BUILTIN | func_flags::IS_OF_BUILTIN_MODULE) {
            continue;
        }
        let module = func.module.idx();
        let entered = places_entered(program, func);
        let members = members_entered(program, func);
        let calls = calls_entered(program, func);
        let held_again: FxHashMap<V, V> = (func.blocks.iter().flat_map(|block| &block.ops))
            .filter_map(|&later| match func.op(later) {
                Some(&Op::Coerce { value, .. }) => Some((value, later)),
                _ => None,
            })
            .collect();
        let path = &modules[module].path;
        let mut step = |pos: u32, kind: Kind, what: &str, rest: &str, fixed: Option<u32>| {
            let name = program.strs.get(func.name);
            let name: &[u8] = if name.is_empty() { b"<anonymous>" } else if name.starts_with(b"module ") { b"module" } else { name };
            let (line, column) = lines[module].as_ref().map_or((0, pos as usize), |lines| lines.line_and_column(pos));
            let ordinal = numbers.ordinal(module, pos, (line, column), kind, what, rest, fixed) as usize;
            let mut text = format!("{{\"id\":\"{}\",\"ordinal\":{ordinal},", id_of(path, line, column, kind.as_str(), ordinal));
            let other = match kind {
                Kind::AsConvert => Some(Kind::AsRefuse),
                Kind::FieldRedefine => Some(Kind::FieldStoreUntyped),
                _ => None,
            };
            if let Some(other) = other {
                let _ = write!(text, "\"otherKind\":\"{}\",\"otherId\":\"{}\",", other.as_str(), id_of(path, line, column, other.as_str(), ordinal));
            }
            let _ = write!(text, "\"kind\":\"{}\",\"what\":\"{what}\",\"line\":{line},\"col\":{column},\"fn\":", kind.as_str());
            quoted(&mut text, name);
            text.push_str(rest);
            text.push('}');
            text
        };
        let spans: FxHashMap<V, Span> = func.spans.iter().filter(|span| span.value.is_some() && span.step > STORED).map(|&span| (span.value, span)).collect();
        let operands: FxHashMap<(V, i32), Span> = func.spans.iter().filter(|span| span.step <= STORED).map(|&span| ((span.value, span.step), span)).collect();
        let first_chain = chains_by_module[module].len();
        let mut chain_of: FxHashMap<V, usize> = FxHashMap::default();
        let mut lacking: Vec<String> = Vec::new();
        for block in &func.blocks {
            for &v in &block.ops {
                let pos = func.values[v.idx()].pos;
                if pos == 0 {
                    continue;
                }
                for (row, at, passing) in rules(program, func, v, &spans, &operands, is_linked) {
                    let line = step(pos, row.kind, row.what, &[&row.rest[..], if is_linked { "" } else { ",\"unsure\":2" }].concat(), None);
                    if let Some(at) = at {
                        chains_by_module[module].push(Chain { start: at.start, end: at.end, step: 0, passes: passing, whole_numbers: None, steps: vec![(v, line)] });
                    }
                }
                let Some(held) = held(program, func, v, is_linked) else { continue };
                let mut line = String::from(",\"to\":");
                write_type(program, &mut line, held.to, 0);
                if held.result != held.to {
                    line.push_str(",\"result\":");
                    write_type(program, &mut line, held.result, 0);
                }
                if held.text.is_some() {
                    line.push_str(",\"text\":");
                    quoted(&mut line, program.strs.get(held.text));
                }
                if let Some(member) = members.get(&v) {
                    line.push_str(",\"on\":");
                    quoted(&mut line, member.as_bytes());
                }
                for (i, behind) in conversions_behind(func, v).into_iter().enumerate() {
                    let (line_of_it, column) = lines[module].as_ref().map_or((0, behind as usize), |lines| lines.line_and_column(behind));
                    let _ = write!(line, "{}\"{line_of_it}:{column}\"", if i == 0 { ",\"after\":[" } else { "," });
                }
                if !conversions_behind(func, v).is_empty() {
                    line.push(']');
                }
                if held.is_known_by_the_link_alone {
                    line.push_str(",\"unsure\":2");
                } else if !is_linked && held.what != "NonNull" {
                    line.push_str(",\"unsure\":1");
                }
                let kind = kind_of(program, func, v, &entered);
                let mut entering = v;
                while !calls.contains_key(&entering)
                    && let Some(&next) = held_again.get(&entering)
                {
                    entering = next;
                }
                if let (Some(&(call, index)), Some(lines)) = (calls.get(&entering), lines[module].as_ref())
                    && call != 0
                {
                    let (line_of_call, column_of_call) = lines.line_and_column(call);
                    let _ = write!(line, ",\"callId\":\"{}\"", id_of(path, line_of_call, column_of_call, Kind::EnterArgument.as_str(), index));
                }
                let line = step(pos, kind, &held.what, &line, None);
                let Some(&span) = spans.get(&v) else {
                    lacking.push(line);
                    continue;
                };
                let passing = match &*held.what {
                    "IteratorOpen" => prim::NULLISH,
                    "Coerce" => passes(program, program.tys.get(held.to)) | passes(program, program.tys.get(held.result)),
                    _ => passes(program, program.tys.get(held.to)),
                };
                let chains = &mut chains_by_module[module];
                let earlier = chain_of.get(&held.from).copied().filter(|&chain| span.start <= chains[chain].start && chains[chain].end <= span.end && chains[chain].step == span.step);
                let chain = earlier.unwrap_or_else(|| {
                    chains.push(Chain { start: span.start, end: span.end, step: span.step, passes: class::ALL, whole_numbers: Some(EVERY_INT32).filter(|_| span.step == 0), steps: Vec::new() });
                    chains.len() - 1
                });
                (chains[chain].start, chains[chain].end) = (span.start, span.end);
                chains[chain].passes &= passing;
                chains[chain].whole_numbers = if &*held.what == "IteratorOpen" { None } else { whole_numbers_within(chains[chain].whole_numbers, program.tys.get(held.to)) };
                chains[chain].steps.push((v, line));
                chain_of.insert(v, chain);
            }
        }
        for chain in &mut chains_by_module[module][first_chain..] {
            chain.steps.sort_by_key(|step| step.0);
        }
        let mut parameters: Vec<Parameter> = Vec::new();
        if !is_linked || func.has(func_flags::IS_VALUE) || func.kind == crate::ir::FuncKind::Method {
            let body = func.spans.iter().find(|span| span.value.is_none() && span.step > STORED);
            let first = func.captures.len() + usize::from(func.has(func_flags::HAS_THIS));
            let entry = func.blocks.first().map_or(&[][..], |block| &block.params[..]);
            let ahead = usize::from(func.kind == crate::ir::FuncKind::Constructor && func.has(func_flags::HAS_NEW_TARGET));
            for (place, &param) in func.params.iter().enumerate() {
                let Some(&v) = entry.get(first + place) else { break };
                let index = place.saturating_sub(ahead);
                if param.is_none() || param == program.tys.anything || func.has(func_flags::IS_HIDDEN_IN_STACK_TRACES | func_flags::IS_CODE_OF_MODULE) {
                    continue;
                }
                let mut rest = format!(",\"index\":{index},\"to\":");
                write_type(program, &mut rest, param, 0);
                if !is_linked {
                    rest.push_str(if func.has(func_flags::IS_VALUE) || func.kind == crate::ir::FuncKind::Method { ",\"unsure\":1" } else { ",\"unsure\":2" });
                }
                let step = step(func.pos, Kind::EnterFunction, "As", &rest, Some(index as u32));
                let (Some(body), Some(span)) = (body, spans.get(&v)) else { continue };
                let declared = program.tys.get(param);
                let objects = if declared.has_objects() { class::OBJECT | class::FUNCTION } else { 0 };
                parameters.push(Parameter { function: body.step as u32, index: index as u32, start: span.start, end: span.end, body: (body.start, body.end), passes: passes(program, declared) | objects, least: as_int32s(whole_numbers_within(Some(EVERY_INT32), declared)).0, most: as_int32s(whole_numbers_within(Some(EVERY_INT32), declared)).1, step });
            }
        }
        modules[module].without_span.append(&mut lacking);
        modules[module].parameters.append(&mut parameters);
    }
    for (module, mut chains) in modules.iter_mut().zip(chains_by_module) {
        chains.sort_by_key(|chain| (chain.start, std::cmp::Reverse(chain.end), chain.step));
        let mut seen: Vec<String> = Vec::new();
        let mut key = None;
        for chain in chains {
            if key != Some((chain.start, chain.end, chain.step)) {
                key = Some((chain.start, chain.end, chain.step));
                seen.clear();
                module.groups.push(Group { start: chain.start, end: chain.end, step: chain.step, passes: class::ALL, least: i32::MIN, most: i32::MAX, steps: String::new() });
            }
            let group = module.groups.last_mut().expect("one was pushed");
            group.passes &= chain.passes;
            let (least, most) = as_int32s(chain.whole_numbers);
            (group.least, group.most) = (group.least.max(least), group.most.min(most));
            for (_, step) in chain.steps {
                if seen.contains(&step) {
                    continue;
                }
                if !group.steps.is_empty() {
                    group.steps.push(',');
                }
                group.steps.push_str(&step);
                seen.push(step);
            }
        }
        module.parameters.sort_by_key(|parameter| (parameter.function, parameter.index));
        module.parameters.dedup_by_key(|parameter| (parameter.function, parameter.index));
    }
    (modules, numbers.sites)
}

pub fn program_of_fragment(fragment: crate::fragment::Fragment, shown_from: &[u8], is_case_sensitive: bool, line_table_of: &dyn Fn(&[u8]) -> Vec<u8>) -> Program {
    use crate::id::{FuncId, LayoutId, StrId};
    let crate::fragment::Fragment { path, strs, tys, modules, layouts, funcs, .. } = fragment;
    let mut program = Program { strs, tys, ..Program::default() };
    let line_table = line_table_of(program.strs.get(path));
    let shown = bun_sema::resolve::get_relative_path_from_directory(shown_from, program.strs.get(path), is_case_sensitive);
    let path = program.strs.intern(&shown);
    program.layouts = (layouts.into_iter())
        .map(|shape| match shape.definition {
            Some(definition) => definition.layout,
            None => crate::ir::Layout {
                kind: LayoutKind::Record,
                name: shape.name,
                base: LayoutId::NONE,
                fields: Vec::new(),
                methods: Vec::new(),
                constructor: FuncId::NONE,
                class_flags: 0,
                environment: LayoutId::NONE,
                static_fields: Vec::new(),
                is_allocated: false,
                may_be_frozen: false,
                admits_foreign: false,
                members: Vec::new(),
                members_by_fit: Vec::new(),
                specializations: Vec::new(),
                declared_path: StrId::NONE,
                declared_line: 0,
            },
        })
        .collect();
    program.funcs = (funcs.into_iter())
        .map(|function| {
            function.func.unwrap_or_else(|| Func {
                name: StrId::NONE,
                module: crate::id::ModuleId::NONE,
                pos: 0,
                place_of_text: 0,
                end_of_text: 0,
                kind: crate::ir::FuncKind::Plain,
                flags: 0,
                length: 0,
                captures: Vec::new(),
                this_declared: TyId::NONE,
                params: Vec::new(),
                annotated: Vec::new(),
                result: TyId::NONE,
                blocks: Vec::new(),
                values: Vec::new(),
                spans: Vec::new(),
            })
        })
        .collect();
    program.modules = modules.iter().map(|_| crate::ir::Module { path, init: FuncId::NONE, display_path: path, line_table: line_table.clone(), printed: Vec::new() }).collect();
    program
}

pub fn to_json(modules: &[Module], shapes: &[(String, String)]) -> String {
    let mut out = String::from("{\"shapes\":{");
    for (index, (key, text)) in shapes.iter().enumerate() {
        out.push_str(if index > 0 { ",\n" } else { "\n" });
        quoted(&mut out, key.as_bytes());
        out.push(':');
        out.push_str(text);
    }
    out.push_str("},\"modules\":[");
    for (index, module) in modules.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        out.push_str("\n{\"path\":");
        quoted(&mut out, &module.path);
        if let Some(length) = module.length_of_text {
            let _ = write!(out, ",\"bytes\":{length}");
        }
        out.push_str(",\"parameters\":[");
        for (i, parameter) in module.parameters.iter().enumerate() {
            let _ = write!(out, "{}\n{{\"function\":{},\"index\":{},\"start\":{},\"end\":{},\"body\":[{},{}],\"passes\":{},\"least\":{},\"most\":{},\"step\":{}}}", if i > 0 { "," } else { "" }, parameter.function, parameter.index, parameter.start, parameter.end, parameter.body.0, parameter.body.1, parameter.passes, parameter.least, parameter.most, parameter.step);
        }
        out.push_str("],\"withoutSpan\":[\n");
        out.push_str(&module.without_span.join(",\n"));
        out.push_str("],\"groups\":[");
        for (i, group) in module.groups.iter().enumerate() {
            let _ = write!(out, "{}\n{{\"start\":{},\"end\":{},\"step\":{},\"passes\":{},\"least\":{},\"most\":{},\"steps\":[{}]}}", if i > 0 { "," } else { "" }, group.start, group.end, group.step, group.passes, group.least, group.most, group.steps);
        }
        out.push_str("]}");
    }
    out.push_str("]}\n");
    out
}

#[cfg(test)]
mod tests {
    use super::{Lines, id_of};
    use crate::format::line_table;

    #[test]
    fn lines_are_read_as_they_are_written() {
        let text = "a\n\u{e9}=1\r\n\u{1f600}x\u{20ac}y".as_bytes();
        let lines = Lines::read(&line_table(text, &[0, 2, 8])).expect("a table");
        assert_eq!(lines.line_and_column(0), (1, 1));
        assert_eq!(lines.line_and_column(2), (2, 1));
        assert_eq!(lines.line_and_column(4), (2, 2));
        assert_eq!(lines.line_and_column(8), (3, 1));
        assert_eq!(lines.line_and_column(12), (3, 3));
        assert_eq!(lines.line_and_column(16), (3, 5));
    }

    #[test]
    fn an_id_is_the_folded_hash() {
        assert_eq!(id_of(b"h01_audit.ts", 3, 19, "read-property", 0), "ad8cb700bf69");
    }
}
