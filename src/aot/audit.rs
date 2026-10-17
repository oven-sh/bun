use crate::declared::{Declared, Part, prim};
use crate::format::record;
use crate::id::{BlockId, TyId, V};
use crate::ir::{BinOp, Def, Func, LayoutKind, Op, Operation, Program, Span, Term, UnOp, CoerceReason, func_flags};
use bun_sema::util::{InParallel, for_each_mut};
use rustc_hash::FxHashMap;
use std::fmt::Write;

#[derive(Copy, Clone)]
pub struct RecordedSpan {
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

    fn post_dominates(&self, later: usize, earlier: usize) -> bool {
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
pub(crate) const VALIDATION: i32 = i32::MIN + 3;

pub(crate) fn settle(func: &Func, noted: &FxHashMap<V, RecordedSpan>) -> Vec<Span> {
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
            Some(&Op::Coerce { to, why, .. }) if !matches!(why, CoerceReason::Upcast | CoerceReason::Forced) => Some(to),
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
        let mut origin = value;
        while let Some(&Op::Coerce { value: coercion_site, .. }) = func.op(origin) {
            origin = coercion_site;
        }
        let is_allocated_within = func.op(origin).is_some() && (span.start..span.end).contains(&func.values[origin.idx()].pos) && made_in[origin.idx()] != u32::MAX;
        let from = if is_allocated_within { made_in[origin.idx()] as usize } else { span.block.idx() };
        if here as usize == from || after.post_dominates(here as usize, from) {
            spans.push(Span { value, start: span.start, end: span.end, step: span.step });
            continue;
        }
        spans.extend(span_at_merge(func, noted, value, to, here as usize));
    }
    let unrecorded_checks = |value: V| match func.op(value) {
        Some(&Op::Coerce { value: coercion_site, to, why }) if !matches!(why, CoerceReason::Upcast | CoerceReason::Forced) && !noted.contains_key(&value) => Some((coercion_site, to, why)),
        _ => None,
    };
    let all = || func.blocks.iter().flat_map(|block| &block.ops).copied();
    let rechecked: FxHashMap<V, V> = all().filter_map(|value| Some((unrecorded_checks(value)?.0, value))).collect();
    for claim in all().filter(|&value| matches!(unrecorded_checks(value), Some((_, _, CoerceReason::Claim)))) {
        let mut chain = vec![claim];
        while let Some(&next) = rechecked.get(&chain[chain.len() - 1]) {
            chain.push(next);
        }
        let last = chain[chain.len() - 1];
        if let Some((_, to, _)) = unrecorded_checks(last)
            && let Some(span) = span_at_merge(func, noted, last, to, made_in[last.idx()] as usize)
        {
            spans.extend(chain.into_iter().filter(|&value| unrecorded_checks(value).is_some_and(|coercion_site| coercion_site.1 == to)).map(|value| Span { value, ..span }));
        }
    }
    spans.sort_unstable_by_key(|span| span.value);
    spans.dedup_by_key(|span| span.value);
    spans
}

/// The parameter of a block that `value` is handed to, from the end of the block that makes it or, in a `try`, of one that follows.
fn block_param_receiving<'a>(func: &'a Func, value: V, mut end: &'a Option<Term>) -> Option<V> {
    for _ in 0..16 {
        match end {
            Some(Term::Invoke { normal, .. }) if !normal.args.contains(&value) => end = &func.blocks[normal.block.idx()].term,
            Some(Term::Jump(target) | Term::Invoke { normal: target, .. }) => return target.args.iter().position(|&arg| arg == value).map(|index| func.blocks[target.block.idx()].params[index]),
            _ => return None,
        }
    }
    None
}

fn span_at_merge(func: &Func, noted: &FxHashMap<V, RecordedSpan>, value: V, to: TyId, mut at: usize) -> Option<Span> {
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
    for c in bstr::BStr::new(bytes).to_string().chars() {
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
    let prims = Declared::prims(prims).with_literal_string_widened().prims;
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

pub fn layout_name(program: &Program, layout: crate::id::LayoutId) -> String {
    let layout = &program.layouts[layout.idx()];
    if layout.name.is_some() && !program.strs.get(layout.name).is_empty() {
        return bstr::BStr::new(program.strs.get(layout.name)).to_string();
    }
    let mut result = String::from("{");
    for (i, field) in layout.fields.iter().take(4).enumerate() {
        result.push_str(if i == 0 { " " } else { ", " });
        result.push_str(&bstr::BStr::new(program.strs.get(field.name)).to_string());
    }
    result.push_str(if layout.fields.len() > 4 { ", ... }" } else { " }" });
    result
}

pub fn widen_layoutless_classes_to_any_object(program: &mut Program) {
    for declared in program.tys.list.iter_mut() {
        let before = declared.parts.len();
        declared.parts.retain(|part| !matches!(part, Part::Class(layout) if layout.is_none()));
        declared.any_object |= declared.parts.len() != before;
    }
}

pub fn describe(program: &Program, ty: TyId) -> String {
    let declared = program.tys.get(ty);
    if declared.any_object && declared.prims & prim::ALL == prim::ALL {
        return "any".to_owned();
    }
    let mut result = String::new();
    for part in &declared.parts {
        if let Part::Class(layout) = part {
            append_member(&mut result, true, &layout_name(program, *layout));
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
            Part::Global(name, _) => append_member(&mut result, true, &bstr::BStr::new(program.strs.get(*name)).to_string()),
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

fn may_hold_untyped_object(program: &Program, declared: &Declared, is_linked: bool) -> bool {
    !is_linked
        || declared.any_object
        || declared.any_function
        || declared.prims & !prim::NULLISH != 0
        || declared.parts.iter().any(|part| match part {
            Part::Class(layout) => {
                let layout = &program.layouts[layout.idx()];
                layout.accepts_untyped || layout.kind == LayoutKind::Environment
            }
            Part::Global(..) | Part::Array(_) => true,
        })
}

fn is_number_or_nullish_or_boolean(declared: &Declared) -> bool {
    !declared.has_objects() && declared.prims & (prim::STRING | prim::SYMBOL | prim::BIGINT) == 0
}

fn is_implied_by_operands(program: &Program, func: &Func, op: &Op, yields: &Declared) -> bool {
    let of = |v: V| program.tys.get(func.ty(v));
    let accepts_numbers = yields.prims & prim::NUMBER != 0 || yields.ints.is_some();
    match *op {
        Op::Binary { op: BinOp::Add, a, b } => {
            let (a, b) = (of(a), of(b));
            let is_string = |declared: &Declared| !declared.has_objects() && declared.ints.is_none() && declared.prims == prim::STRING;
            if is_number_or_nullish_or_boolean(a) && is_number_or_nullish_or_boolean(b) {
                return accepts_numbers;
            }
            yields.prims & prim::STRING != 0 && (is_string(a) || is_string(b)) && !a.has_objects() && !b.has_objects() && (a.prims | b.prims) & prim::SYMBOL == 0
        }
        Op::Binary { a, b, .. } => accepts_numbers && is_number_or_nullish_or_boolean(of(a)) && is_number_or_nullish_or_boolean(of(b)),
        Op::Unary { op: UnOp::Neg | UnOp::ToNumeric | UnOp::BitNot | UnOp::ToNumber, a } => accepts_numbers && is_number_or_nullish_or_boolean(of(a)),
        _ => true,
    }
}

struct CoercionSite {
    is_known_only_at_link: bool,
    what: String,
    to: TyId,
    result: TyId,
    text: crate::id::StrId,
    from: V,
}

fn coercion_site(program: &Program, func: &Func, v: V, is_linked: bool, linked: Option<&Linked>) -> Option<CoercionSite> {
    let value = &func.values[v.idx()];
    let Def::Op(op) = &value.def else { return None };
    let anything = program.tys.anything;
    let none = crate::id::StrId::NONE;
    if let Op::Coerce { value: from, to, why } = *op {
        let (what, text) = match why {
            CoerceReason::Upcast | CoerceReason::Forced | CoerceReason::ArgumentClaim(_) => return None,
            CoerceReason::Store => ("Store", none),
            CoerceReason::Cast | CoerceReason::CastFresh => ("As", none),
            CoerceReason::NonNull(text) => ("NonNull", text),
            CoerceReason::Claim => ("Claim", none),
            CoerceReason::Flow => ("Flow", none),
            CoerceReason::Coerce | CoerceReason::CoerceFreshGraph => ("Coerce", none),
        };
        return Some(CoercionSite { is_known_only_at_link: false, what: what.to_owned(), to, result: value.ty, text, from });
    }
    if let Op::IterOpen(iterated) = *op {
        let ty = func.ty(iterated);
        let declared = program.tys.get(ty);
        let is_array = !declared.parts.is_empty() && !declared.any_object && declared.parts.iter().all(|part| matches!(part, Part::Array(_)));
        return is_array.then(|| CoercionSite { is_known_only_at_link: false, what: "IteratorOpen".to_owned(), to: ty, result: ty, text: none, from: V::NONE });
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
        Op::PropGet { obj, .. } | Op::ElemGet { obj, .. } => may_hold_untyped_object(program, program.tys.get(func.ty(*obj)), is_linked),
        Op::Call { .. } if linked.is_some() && value.is_in_tail_position() => false,
        Op::CallDirect { func: called, .. } => !value.is_in_tail_position() && linked.is_some_and(|linked| linked.returns_unchecked[called.idx()]),
        Op::Call { .. } | Op::CallMethod { .. } | Op::Construct { .. } | Op::Await(_) | Op::Yield(_) | Op::Operation { .. } | Op::IterGet { .. } | Op::Caught | Op::FreeGet { is_typeof: false, .. } => true,
        Op::Binary { .. } | Op::Unary { .. } => !is_implied_by_operands(program, func, op, program.tys.get(value.ty)),
        _ => false,
    };
    let is_known_only_at_link = !is_linked && matches!(op, Op::PropGet { obj, .. } | Op::ElemGet { obj, .. } if !may_hold_untyped_object(program, program.tys.get(func.ty(*obj)), true));
    is_held.then(|| CoercionSite { is_known_only_at_link, what: format!("{:?}", record(&value.def).opcode), to: value.ty, result: value.ty, text: none, from: V::NONE })
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

pub struct Validation {
    pub start: u32,
    pub end: u32,
    pub which: u8,
    pub plan: Vec<u8>,
}

pub struct Module {
    pub path: Vec<u8>,
    pub source_len: Option<usize>,
    pub groups: Vec<Group>,
    pub parameters: Vec<Parameter>,
    pub without_span: Vec<String>,
    pub validations: Vec<Validation>,
}

pub mod class {
    pub const OBJECT: u32 = 1 << 8;
    pub const FUNCTION: u32 = 1 << 9;
    pub const ALL: u32 = (1 << 10) - 1;
    /// No class of its own: an object with the tag that the audit gives to what typed code has made and to what has entered a record type.
    pub const TAGGED: u32 = 1 << 10;
    /// No class of its own either: an array that is no Proxy.
    pub const ARRAY: u32 = 1 << 14;
    pub const HAS_UNTYPED_CLONE: u32 = 1 << 12;
    pub const READS_ARRAY_ELEMENT: u32 = 1 << 13;
    pub const STORES_THROUGH_UNTYPED: u32 = 1 << 15;
}

fn is_closed(program: &Program, layout: crate::id::LayoutId) -> bool {
    let described = &program.layouts[layout.idx()];
    let is_named_class = |layout: &crate::ir::Layout| layout.kind == LayoutKind::Instance && layout.name.is_some() && !program.strs.get(layout.name).is_empty() && layout.class_flags & crate::ir::class_flags::HAS_FIXED_LAYOUT != 0;
    is_named_class(described) && !described.accepts_unchecked_objects() && !described.members.is_empty() && described.members.iter().all(|member| is_named_class(&program.layouts[member.idx()]))
}

/// What is made once of a linked program, for the types that only the link knows about.
struct Linked {
    /// By layout: `shape_key()`, with a number behind it where two records read alike but for the views they name.
    keys: Vec<String>,
    /// By layout: an operation of the program allocates it. `Layout::is_allocated` also says so of what only a cast makes.
    is_allocated_by_op: Vec<bool>,
    /// By layout: the views that have it among their members.
    seen_as: Vec<Vec<u32>>,
    /// By layout: `Layout::mayDespecialize` in AOTTypedReader.cpp.
    gives_up: Vec<bool>,
    /// By function: what it returns may come straight from a call in tail position that nothing holds: of a value, or of such a function.
    returns_unchecked: Vec<bool>,
    /// By layout and name of a field: the kinds of primitives of all the fields that may share its slot, `shareSlots()` in AOTTypedPlacement.cpp.
    slot_primitives: FxHashMap<(u32, crate::id::StrId), u32>,
}

impl Linked {
    fn of(program: &Program) -> Linked {
        let mut seen_as: Vec<Vec<u32>> = vec![Vec::new(); program.layouts.len()];
        for (index, view) in program.layouts.iter().enumerate() {
            for member in &view.members {
                seen_as[member.idx()].push(index as u32);
            }
        }
        let mut place_of: FxHashMap<(u32, crate::id::StrId), u32> = FxHashMap::default();
        let (mut first_of, mut primitives): (Vec<u32>, Vec<u32>) = (Vec::new(), Vec::new());
        for (index, layout) in program.layouts.iter().enumerate() {
            for field in &layout.fields {
                place_of.insert((index as u32, field.name), first_of.len() as u32);
                first_of.push(first_of.len() as u32);
                primitives.push(program.tys.get(if field.declared.is_some() { field.declared } else { program.tys.anything }).clone().with_literal_string_widened().prims);
            }
        }
        fn first(first_of: &mut [u32], mut place: u32) -> u32 {
            while first_of[place as usize] != place {
                first_of[place as usize] = first_of[first_of[place as usize] as usize];
                place = first_of[place as usize];
            }
            place
        }
        for (index, view) in program.layouts.iter().enumerate() {
            for field in &view.fields {
                for member in &view.members {
                    let Some(&theirs) = place_of.get(&(member.idx() as u32, field.name)) else { continue };
                    let (ours, theirs) = (first(&mut first_of, place_of[&(index as u32, field.name)]), first(&mut first_of, theirs));
                    if ours != theirs {
                        first_of[theirs as usize] = ours;
                        primitives[ours as usize] |= primitives[theirs as usize];
                    }
                }
            }
        }
        let slot_primitives = place_of.iter().map(|(&field, &place)| (field, primitives[first(&mut first_of, place) as usize])).collect();
        let gives_up: Vec<bool> = (program.layouts.iter().zip(&seen_as))
            .map(|(described, views)| {
                matches!(described.kind, LayoutKind::Record | LayoutKind::Instance)
                    && described.is_allocated
                    && described.accepts_unchecked_objects()
                    && !views.iter().any(|&view| !program.layouts[view as usize].accepts_untyped)
            })
            .collect();
        let mut alike: FxHashMap<String, u32> = FxHashMap::default();
        let keys = (0..program.layouts.len())
            .map(|index| {
                let layout = crate::id::LayoutId::new(index);
                if !retains_fields(program, layout, &gives_up) {
                    return String::new();
                }
                let key = shape_key(program, layout);
                let earlier = alike.entry(key.clone()).or_insert(0);
                *earlier += 1;
                if *earlier == 1 { key } else { format!("{key}.{earlier}") }
            })
            .collect();
        let mut is_allocated_by_op = vec![false; program.layouts.len()];
        let mut returns_unchecked = vec![false; program.funcs.len()];
        let mut direct_tail_calls: Vec<(usize, usize)> = Vec::new();
        for (index, func) in program.funcs.iter().enumerate() {
            for &v in func.blocks.iter().flat_map(|block| &block.ops) {
                match func.op(v) {
                    Some(&(Op::New(layout) | Op::NewWith { layout, .. })) => is_allocated_by_op[layout.idx()] = true,
                    Some(Op::Call { .. }) if func.values[v.idx()].is_in_tail_position() && func.ty(v).is_some() && func.ty(v) != program.tys.anything && !program.tys.get(func.ty(v)).is_never() => returns_unchecked[index] = true,
                    Some(&Op::CallDirect { func: called, .. }) if func.values[v.idx()].is_in_tail_position() => direct_tail_calls.push((index, called.idx())),
                    _ => {}
                }
            }
        }
        while direct_tail_calls.iter().fold(false, |grew, &(caller, called)| {
            let grows = returns_unchecked[called] && !returns_unchecked[caller];
            returns_unchecked[caller] |= grows;
            grew || grows
        }) {}
        Linked { keys, is_allocated_by_op, seen_as, gives_up, returns_unchecked, slot_primitives }
    }
}

/// A record type that admits no strangers.
fn is_closed_record(program: &Program, layout: crate::id::LayoutId) -> bool {
    let described = &program.layouts[layout.idx()];
    described.kind == LayoutKind::Record && !described.accepts_unchecked_objects()
}

/// Whether an object that typed code has not made is coercion_site to the members of the closed records among the parts. Only the link knows which
/// those are. Where there are several and only a cast makes one of them, a build is seen to let in what fits none: nothing is said there.
/// Nor where nothing can be made, or one of more shapes than are worth trying at every value that comes by: a view over a whole family.
fn is_checked_against_subtypes(program: &Program, declared: &Declared, linked: Option<&Linked>) -> bool {
    const MAX_SHAPES_TRIED: usize = 8;
    let Some(linked) = linked else { return false };
    let closed: Vec<crate::id::LayoutId> = (declared.parts.iter())
        .filter_map(|part| match part {
            Part::Class(layout) if is_closed_record(program, *layout) => Some(*layout),
            _ => None,
        })
        .collect();
    let made: Vec<crate::id::LayoutId> = closed.iter().flat_map(|&view| allocated_as(program, view)).collect();
    !made.is_empty() && made.len() <= MAX_SHAPES_TRIED && closed.iter().all(|&view| !allocated_as(program, view).is_empty()) && (closed.len() == 1 || made.iter().all(|made| linked.is_allocated_by_op[made.idx()]))
}

/// What plain data is made one of so that it is of the view: `Coercion::forEachInstantiableLayout()` in AOTTypedObject.cpp.
fn allocated_as(program: &Program, view: crate::id::LayoutId) -> Vec<crate::id::LayoutId> {
    let is_made = |layout: crate::id::LayoutId| program.layouts[layout.idx()].kind == LayoutKind::Record && program.layouts[layout.idx()].is_allocated;
    if program.layouts[view.idx()].is_allocated {
        return vec![view];
    }
    program.layouts[view.idx()].members.iter().copied().filter(|&member| member != view && is_made(member)).collect()
}

/// What the helper asks for by the `view` of a part that is a closed record: once a view, not at every mention.
fn layout_text(program: &Program, view: crate::id::LayoutId, linked: &Linked, generalizations: &[Vec<u32>]) -> String {
    let keys = &linked.keys;
    let mut text = String::from("{\"made\":[");
    for (i, made) in allocated_as(program, view).into_iter().enumerate() {
        if i > 0 {
            text.push(',');
        }
        quoted(&mut text, keys[made.idx()].as_bytes());
    }
    text.push_str("],\"members\":[");
    for (i, key) in member_keys(program, view, linked, generalizations).into_iter().enumerate() {
        if i > 0 {
            text.push(',');
        }
        quoted(&mut text, key.as_bytes());
    }
    let _ = write!(text, "],\"stays\":{}}}", program.layouts[view.idx()].accepts_only_other_layouts);
    text
}

fn despecialization_key(layout: crate::id::LayoutId) -> String {
    format!("gives up {}", layout.idx())
}

/// By layout: the layouts that have it among their specializations.
fn generalizations(program: &Program) -> Vec<Vec<u32>> {
    let mut found = vec![Vec::new(); program.layouts.len()];
    for (index, layout) in program.layouts.iter().enumerate() {
        for specialization in &layout.specializations {
            found[specialization.idx()].push(index as u32);
        }
    }
    found
}

fn member_keys(program: &Program, view: crate::id::LayoutId, linked: &Linked, generalizations: &[Vec<u32>]) -> Vec<String> {
    let keys = &linked.keys;
    let mut become_members: Vec<usize> = program.layouts[view.idx()].members.iter().map(|member| member.idx()).collect();
    let mut seen: rustc_hash::FxHashSet<usize> = become_members.iter().copied().collect();
    let mut at = 0;
    while at < become_members.len() {
        for &general in &generalizations[become_members[at]] {
            if seen.insert(general as usize) {
                become_members.push(general as usize);
            }
        }
        at += 1;
    }
    become_members.sort_unstable();
    become_members.dedup();
    (become_members.into_iter())
        .filter(|&layout| program.layouts[layout].kind == LayoutKind::Record)
        .filter_map(|layout| {
            let id = crate::id::LayoutId::new(layout);
            if !keys[layout].is_empty() {
                Some(keys[layout].clone())
            } else if linked.gives_up[layout] {
                Some(despecialization_key(id))
            } else {
                None
            }
        })
        .collect()
}

fn narrows_records(program: &Program, from: &Declared, to: &Declared) -> bool {
    let members = |declared: &Declared| -> Vec<crate::id::LayoutId> {
        (declared.parts.iter())
            .filter_map(|part| match part {
                Part::Class(view) => Some(&program.layouts[view.idx()].members),
                _ => None,
            })
            .flatten()
            .copied()
            .collect()
    };
    let taken = members(to);
    members(from).into_iter().any(|member| program.layouts[member.idx()].kind == LayoutKind::Record && program.layouts[member.idx()].is_allocated && !taken.contains(&member))
}

/// Whether a place of the type can hold an object that typed code has not made. Where it cannot, what is cast from it brings no stranger.
fn may_be_untyped_object(program: &Program, declared: &Declared) -> bool {
    declared.any_object || declared.parts.iter().any(|part| matches!(part, Part::Class(layout) if program.layouts[layout.idx()].accepts_unchecked_objects()))
}

fn passes(program: &Program, declared: &Declared, linked: Option<&Linked>) -> u32 {
    let is_held = is_checked_against_subtypes(program, declared, linked);
    let accepts_any_object = declared.any_object || declared.parts.iter().any(|part| matches!(part, Part::Class(layout) if !is_closed(program, *layout) && !(is_held && is_closed_record(program, *layout))));
    let accepts_any_function = declared.any_object
        || declared.any_function
        || declared.parts.iter().any(|part| match part {
            Part::Array(_) => false,
            Part::Class(layout) => !(is_held && is_closed_record(program, *layout)),
            Part::Global(..) => linked.is_none(),
        });
    let accepts_any_array = accepts_any_object || declared.parts.iter().any(|part| matches!(part, Part::Array(_)));
    declared.clone().with_literal_string_widened().prims | if accepts_any_object { class::OBJECT | class::TAGGED } else { 0 } | if accepts_any_function { class::FUNCTION } else { 0 } | if accepts_any_array { class::ARRAY } else { 0 }
}

fn write_type(program: &Program, out: &mut String, ty: TyId, depth: u32, linked: Option<&Linked>) {
    let declared = program.tys.get(ty);
    let is_held = is_checked_against_subtypes(program, declared, linked);
    let _ = write!(out, "{{\"p\":{},\"o\":{},\"fn\":{}", declared.clone().with_literal_string_widened().prims, declared.any_object, declared.any_function);
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
                let _ = write!(out, "{{\"k\":\"class\",\"instance\":{},\"foreign\":{},\"name\":", described.kind == LayoutKind::Instance, described.accepts_unchecked_objects());
                quoted(out, layout_name(program, *layout).as_bytes());
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
                if is_held && is_closed_record(program, *layout) {
                    let _ = write!(out, ",\"view\":\"view {}\"", layout.idx());
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
                    write_type(program, out, *elements, depth + 1, linked);
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
enum EntrySlot {
    Argument,
    Field,
    Return,
    Variable,
}

fn entered_slots(program: &Program, func: &Func) -> FxHashMap<V, EntrySlot> {
    let mut entered: FxHashMap<V, EntrySlot> = FxHashMap::default();
    for block in &func.blocks {
        for &v in &block.ops {
            match func.op(v) {
                Some(Op::CallDirect { args, .. } | Op::Call { args, .. } | Op::CallMethod { args, .. } | Op::Construct { args, .. }) => {
                    for &arg in args {
                        entered.entry(arg).or_insert(EntrySlot::Argument);
                    }
                }
                Some(&(Op::PropSet { value, .. } | Op::ElemSet { value, .. })) => {
                    entered.entry(value).or_insert(EntrySlot::Field);
                }
                Some(&Op::FieldSet { value, layout, .. }) => {
                    entered.entry(value).or_insert(if program.layouts[layout.idx()].kind == LayoutKind::Environment { EntrySlot::Variable } else { EntrySlot::Field });
                }
                Some(Op::Operation { which: Operation::Initialize, args }) => {
                    for &arg in args {
                        entered.entry(arg).or_insert(EntrySlot::Field);
                    }
                }
                _ => {}
            }
        }
        if let Some(Term::Return(value)) = block.term {
            entered.entry(value).or_insert(EntrySlot::Return);
        }
    }
    entered
}

fn entered_calls(program: &Program, func: &Func) -> FxHashMap<V, (u32, usize)> {
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

fn entered_members(program: &Program, func: &Func) -> FxHashMap<V, String> {
    let mut entered: FxHashMap<V, String> = FxHashMap::default();
    let member = |layout: crate::id::LayoutId, name: &[u8]| format!("{}.{}", layout_name(program, layout), bstr::BStr::new(name));
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

fn strip_casts(func: &Func, mut v: V) -> V {
    while let Some(&Op::Coerce { value, why, .. }) = func.op(v)
        && why != CoerceReason::Coerce
    {
        v = value;
    }
    v
}

fn result_kind(op: Option<&Op>) -> Kind {
    match op {
        Some(Op::PropGet { .. }) => Kind::ReadProperty,
        Some(Op::ElemGet { .. }) => Kind::ReadElement,
        Some(Op::Await(_)) => Kind::AwaitResult,
        Some(Op::IterGet { .. } | Op::Yield(_)) => Kind::IterateValue,
        Some(Op::Coerce { why: CoerceReason::Coerce | CoerceReason::CoerceFreshGraph, .. }) => Kind::AsLateUse,
        Some(Op::Binary { .. } | Op::Unary { .. }) => Kind::ArithmeticResult,
        _ => Kind::CallResult,
    }
}

fn kind_of(program: &Program, func: &Func, v: V, entered: &FxHashMap<V, EntrySlot>) -> Kind {
    let Some(&Op::Coerce { value, to, why }) = func.op(v) else {
        return if matches!(func.op(v), Some(Op::IterOpen(_))) { Kind::ArrayNotPlain } else { result_kind(func.op(v)) };
    };
    let accepts_only_integers = program.tys.get(to).ints.is_some() && program.tys.get(to).prims & prim::NUMBER == 0;
    match why {
        CoerceReason::Coerce | CoerceReason::CoerceFreshGraph => Kind::AsConvert,
        CoerceReason::NonNull(_) => Kind::NonNull,
        CoerceReason::Flow => Kind::Narrowing,
        CoerceReason::Claim => result_kind(func.op(strip_casts(func, value))),
        CoerceReason::Cast | CoerceReason::CastFresh | CoerceReason::Store if accepts_only_integers => Kind::Int32Range,
        _ => match entered.get(&v) {
            Some(EntrySlot::Argument) => Kind::EnterArgument,
            Some(EntrySlot::Field) => Kind::EnterField,
            Some(EntrySlot::Return) => Kind::EnterReturn,
            Some(EntrySlot::Variable) | None => Kind::EnterVariable,
        },
    }
}

fn conversions_feeding(func: &Func, v: V) -> Vec<u32> {
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
            if matches!(why, CoerceReason::Coerce | CoerceReason::CoerceFreshGraph) {
                found.push(func.values[operand.idx()].pos);
            }
            operand = value;
        }
    }
    found
}

fn retains_fields(program: &Program, layout: crate::id::LayoutId, gives_up: &[bool]) -> bool {
    let described = &program.layouts[layout.idx()];
    match described.kind {
        LayoutKind::Instance => described.class_flags & crate::ir::class_flags::HAS_FIXED_LAYOUT != 0 && described.is_allocated && !gives_up[layout.idx()],
        LayoutKind::Record => described.is_allocated && !gives_up[layout.idx()],
        _ => false,
    }
}

fn shape_text(program: &Program, layout: crate::id::LayoutId, linked: Option<&Linked>) -> String {
    let described = &program.layouts[layout.idx()];
    let mut text = String::from("{\"name\":");
    quoted(&mut text, layout_name(program, layout).as_bytes());
    text.push_str(",\"fields\":{");
    let seen_as: Vec<&crate::ir::Layout> = linked.map_or_else(Vec::new, |linked| linked.seen_as[layout.idx()].iter().map(|&view| &program.layouts[view as usize]).collect());
    for (i, field) in described.fields.iter().filter(|field| field.flags & (crate::ir::field_flags::METHOD | crate::ir::field_flags::NEVER_STORED) == 0).enumerate() {
        if i > 0 {
            text.push(',');
        }
        quoted(&mut text, program.strs.get(field.name));
        let _ = write!(text, ":{{\"optional\":{},\"to\":", field.flags & crate::ir::field_flags::OPTIONAL != 0);
        write_type(program, &mut text, if field.declared.is_some() { field.declared } else { program.tys.anything }, 0, linked);
        if field.flags & crate::ir::field_flags::OPTIONAL == 0 && seen_as.iter().any(|view| view.fields.iter().any(|other| other.name == field.name && other.flags & crate::ir::field_flags::OPTIONAL != 0)) {
            text.push_str(",\"absent\":true");
        }
        if let Some(&prims) = linked.and_then(|linked| linked.slot_primitives.get(&(layout.idx() as u32, field.name))) {
            let _ = write!(text, ",\"also\":{{\"p\":{prims},\"o\":false,\"fn\":false,\"parts\":[],\"t\":\"\"}}");
        }
        text.push('}');
    }
    text.push('}');
    if described.kind == LayoutKind::Record {
        text.push_str(",\"record\":true");
    }
    if described.class_flags & crate::ir::class_flags::MAY_HAVE_OTHER_PROTOTYPE != 0 {
        text.push_str(",\"otherPrototype\":true");
    }
    text.push_str(if linked.is_some() && (described.kind == LayoutKind::Record || described.may_be_frozen) { ",\"frozen\":true}" } else { "}" });
    text
}

fn shape_key(program: &Program, layout: crate::id::LayoutId) -> String {
    let described = &program.layouts[layout.idx()];
    match described.kind {
        LayoutKind::Instance => format!("class {}", bstr::BStr::new(program.strs.get(described.name))),
        _ => format!("record {}", id_of(shape_text(program, layout, None).as_bytes(), 0, 0, "", 0)),
    }
}

pub fn shapes(program: &Program) -> Vec<(String, String)> {
    let linked = Linked::of(program);
    let mut found: Vec<(String, String)> = Vec::new();
    let mut place_of: FxHashMap<String, usize> = FxHashMap::default();
    for index in 0..program.layouts.len() {
        let layout = crate::id::LayoutId::new(index);
        if linked.keys[index].is_empty() {
            continue;
        }
        let described = &program.layouts[index];
        if described.kind == LayoutKind::Instance && (described.name.is_none() || program.strs.get(described.name).is_empty()) {
            continue;
        }
        let text = shape_text(program, layout, Some(&linked));
        let key = linked.keys[index].clone();
        match place_of.get(&key).map(|&place| &mut found[place]) {
            Some(known) if known.1 != text => known.1 = String::from("null"),
            Some(_) => {}
            None => {
                place_of.insert(key.clone(), found.len());
                found.push((key, text));
            }
        }
    }
    let mut views: Vec<crate::id::LayoutId> = (program.tys.list.iter().flat_map(|declared| &declared.parts))
        .filter_map(|part| match part {
            Part::Class(layout) if is_closed_record(program, *layout) && (1..=8).contains(&allocated_as(program, *layout).len()) => Some(*layout),
            _ => None,
        })
        .collect();
    views.sort_unstable();
    views.dedup();
    let generalizations = generalizations(program);
    found.extend(views.into_iter().map(|view| (format!("view {}", view.idx()), layout_text(program, view, &linked, &generalizations))));
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

fn rules(program: &Program, func: &Func, v: V, spans: &FxHashMap<V, Span>, operands: &FxHashMap<(V, i32), Span>, linked: Option<&Linked>) -> Vec<(Rule, Option<Span>, u32)> {
    let keys = linked.map(|linked| &linked.keys[..]);
    let objects_only = class::ALL & !(class::OBJECT | class::FUNCTION);
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
        Some(&(Op::New(layout) | Op::NewWith { layout, .. })) if program.layouts[layout.idx()].kind == LayoutKind::Record && keys.is_some_and(|keys| !keys[layout.idx()].is_empty()) => {
            let mut rest = String::from(",\"shape\":");
            quoted(&mut rest, keys.map_or(&b""[..], |keys| keys[layout.idx()].as_bytes()));
            found.push((Rule { kind: Kind::Made, what: "NewObjectWithShape", rest }, spans.get(&v).copied(), objects_only));
        }
        Some(&(Op::New(layout) | Op::NewWith { layout, .. })) if program.layouts[layout.idx()].kind == LayoutKind::Record && linked.is_some_and(|linked| linked.gives_up[layout.idx()]) => {
            let mut rest = String::from(",\"shape\":");
            quoted(&mut rest, despecialization_key(layout).as_bytes());
            rest.push_str(",\"named\":");
            quoted(&mut rest, layout_name(program, layout).as_bytes());
            found.push((Rule { kind: Kind::Made, what: "NewObjectWithShape", rest }, spans.get(&v).copied(), objects_only));
        }
        Some(&Op::PropDelete { obj, name }) if !is_seen_through(obj) => {
            found.push((Rule { kind: Kind::FieldDelete, what: "DeleteById", rest: named(name) }, operands.get(&(v, RECEIVER)).copied(), objects_only));
        }
        Some(&Op::PropSet { obj, name, .. }) if !is_seen_through(obj) => {
            let pair = match (operands.get(&(v, RECEIVER)), operands.get(&(v, STORED))) {
                (Some(&receiver), Some(&stored)) if receiver.end <= stored.start && !suspends_within(&stored) => Some((receiver, stored)),
                _ => None,
            };
            let of_pair = pair.map_or_else(String::new, |(receiver, stored)| format!(",\"pair\":\"{}:{}\"", receiver.start, stored.end));
            found.push((Rule { kind: Kind::ClassPrototypeWrite, what: "PutById", rest: named(name) + &of_pair + ",\"receives\":true" }, pair.map(|pair| pair.0), objects_only));
            found.push((Rule { kind: Kind::FieldStoreUntyped, what: "PutById", rest: named(name) + &of_pair + ",\"stores\":true" }, pair.map(|pair| pair.1), 0));
        }
        Some(Op::Call { .. } | Op::CallMethod { .. }) => match is_function_of_object(program, func, v) {
            Some("setPrototypeOf") => {
                let is_to_null = matches!(func.op(v), Some(Op::Call { args, .. } | Op::CallMethod { args, .. }) if args.get(1).is_some_and(|&given| matches!(func.op(strip_casts(func, given)), Some(Op::Null))));
                found.push((Rule { kind: Kind::ObjectSetPrototype, what: "Call", rest: String::from(if is_to_null { ",\"toNull\":true" } else { "" }) }, operands.get(&(v, RECEIVER)).copied(), objects_only));
            }
            Some(name) => {
                let kind = if name == "assign" { Kind::FieldStoreUntyped } else { Kind::FieldRedefine };
                found.push((Rule { kind, what: "Call", rest: String::from(",\"validates\":true") }, spans.get(&v).copied(), objects_only));
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
    integer_range: Option<(i64, i64)>,
    steps: Vec<(V, String)>,
}

const FULL_INT32_RANGE: (i64, i64) = (i32::MIN as i64, i32::MAX as i64);

fn integer_range_within(so_far: Option<(i64, i64)>, declared: &Declared) -> Option<(i64, i64)> {
    let (least, most) = so_far?;
    match declared.ints {
        _ if declared.prims & prim::NUMBER != 0 => Some((least, most)),
        Some(within) => Some((least.max(within.0), most.min(within.1))),
        None => None,
    }
}

fn to_int32_range(integer_range: Option<(i64, i64)>) -> (i32, i32) {
    match integer_range {
        Some((least, most)) if least <= most => (least as i32, most as i32),
        _ => (1, 0),
    }
}

pub fn table<'t>(program: &Program, is_linked: bool, text_of: &dyn Fn(&[u8]) -> Option<&'t [u8]>, in_parallel: InParallel<'_>) -> Vec<Module> {
    let mut modules = walk(program, is_linked, text_of, in_parallel).0;
    if is_linked {
        add_classes(program, &mut modules);
    }
    modules
}

pub const CLASS_ITSELF: u32 = u32::MAX;

fn add_classes(program: &Program, modules: &mut [Module]) {
    use crate::ir::{class_flags, method_flags};
    let linked = Linked::of(program);
    for (index, layout) in program.layouts.iter().enumerate().filter(|(_, layout)| layout.kind == LayoutKind::Instance && layout.constructor.is_some() && layout.class_flags & class_flags::HAS_FIXED_LAYOUT != 0) {
        let constructor = &program.funcs[layout.constructor.idx()];
        if constructor.module.is_none() || constructor.source_start == 0 || constructor.has(func_flags::IS_BUILTIN | func_flags::IS_IN_BUILTIN_MODULE) {
            continue;
        }
        let mut replaceable = layout.methods.iter().filter(|method| method.flags & method_flags::STATIC == 0 && method.flags & method_flags::MAY_BE_REPLACED != 0);
        if replaceable.clone().any(|method| method.name.is_none()) {
            continue;
        }
        let mut step = String::from("{\"kind\":\"class-made\",\"replaceable\":[");
        for (i, method) in replaceable.by_ref().enumerate() {
            if i != 0 {
                step.push(',');
            }
            quoted(&mut step, program.strs.get(method.name));
        }
        let _ = write!(step, "],\"constructorMayBeReplaced\":{}", layout.class_flags & class_flags::CONSTRUCTOR_MAY_BE_REPLACED != 0);
        let key = &linked.keys[index];
        if !key.is_empty() {
            step.push_str(",\"shape\":");
            quoted(&mut step, key.as_bytes());
        }
        step.push_str(",\"named\":");
        quoted(&mut step, layout_name(program, crate::id::LayoutId::new(index)).as_bytes());
        step.push('}');
        let found = &mut modules[constructor.module.idx()];
        found.parameters.push(Parameter { function: constructor.source_start - 1, index: CLASS_ITSELF, start: 0, end: 0, body: (0, 0), passes: 0, least: 1, most: 0, step });
    }
    for module in modules {
        module.parameters.sort_by_key(|parameter| (parameter.function, parameter.index));
        module.parameters.dedup_by_key(|parameter| (parameter.function, parameter.index));
    }
}

pub fn sites(program: &Program, in_parallel: InParallel<'_>) -> Vec<Site> {
    walk(program, true, &|_| None, in_parallel).1
}

fn walk<'t>(program: &Program, is_linked: bool, text_of: &dyn Fn(&[u8]) -> Option<&'t [u8]>, in_parallel: InParallel<'_>) -> (Vec<Module>, Vec<Site>) {
    let lines: Vec<Option<Lines>> = program.modules.iter().map(|module| Lines::read(&module.line_table)).collect();
    let linked = is_linked.then(|| Linked::of(program));
    let linked = linked.as_ref();
    let entered_by_untyped_clone: rustc_hash::FxHashSet<(usize, u32)> = (program.funcs.iter())
        .filter(|entry| entry.kind == crate::ir::FuncKind::Method && entry.has(func_flags::IS_GENERIC_ENTRYPOINT) && entry.module.is_some())
        .map(|entry| (entry.module.idx(), entry.pos))
        .collect();
    let mut bodies_at: FxHashMap<(usize, u32), (bool, u32)> = FxHashMap::default();
    for func in program.funcs.iter().filter(|func| func.module.is_some() && !func.blocks.is_empty()) {
        let bodies = bodies_at.entry((func.module.idx(), func.pos)).or_default();
        if func.has(func_flags::IS_HIDDEN_IN_STACK_TRACES) {
            bodies.0 = true;
        } else {
            bodies.1 += 1;
        }
    }
    let modules: Vec<Module> = (program.modules.iter())
        .map(|module| Module { path: program.strs.get(module.display_path).to_vec(), source_len: text_of(program.strs.get(module.display_path)).map(<[u8]>::len), groups: Vec::new(), parameters: Vec::new(), without_span: Vec::new(), validations: Vec::new() })
        .collect();
    let mut walked: Vec<Walked<'_>> = (modules.into_iter().enumerate())
        .map(|(index, module)| Walked { index, funcs: Vec::new(), module, chains: Vec::new(), numbers: Numbers::default() })
        .collect();
    for func in &program.funcs {
        if func.module.is_none() || func.blocks.is_empty() || !func.has(func_flags::IS_TYPED) || func.has(func_flags::IS_BUILTIN | func_flags::IS_IN_BUILTIN_MODULE) {
            continue;
        }
        walked[func.module.idx()].funcs.push(func);
    }
    walked.sort_by_key(|of_module| std::cmp::Reverse(of_module.funcs.iter().map(|func| func.values.len()).sum::<usize>()));
    for_each_mut(&mut walked, in_parallel, &|of_module| walk_module(program, is_linked, linked, &lines, &entered_by_untyped_clone, &bodies_at, of_module));
    walked.sort_by_key(|of_module| of_module.index);
    let mut sites = Vec::new();
    let modules = (walked.into_iter())
        .map(|mut of_module| {
            sites.append(&mut of_module.numbers.sites);
            of_module.module
        })
        .collect();
    (modules, sites)
}

struct Walked<'p> {
    index: usize,
    funcs: Vec<&'p Func>,
    module: Module,
    chains: Vec<Chain>,
    numbers: Numbers,
}

fn used_values(func: &crate::ir::Func) -> Vec<bool> {
    let mut is_used = vec![false; func.values.len()];
    for block in &func.blocks {
        for &value in &block.ops {
            if let Some(op) = func.op(value) {
                op.clone().for_each_operand_mut(|operand| {
                    if operand.is_some() {
                        is_used[operand.idx()] = true;
                    }
                });
            }
        }
        if let Some(term) = &block.term {
            term.for_each_operand(|operand| {
                if operand.is_some() {
                    is_used[operand.idx()] = true;
                }
            });
        }
    }
    is_used
}

fn walk_module(
    program: &Program,
    is_linked: bool,
    linked: Option<&Linked>,
    lines: &[Option<Lines>],
    entered_by_untyped_clone: &rustc_hash::FxHashSet<(usize, u32)>,
    bodies_at: &FxHashMap<(usize, u32), (bool, u32)>,
    walked: &mut Walked<'_>,
) {
    let Walked { index, funcs, module: found, chains: chains_of_module, numbers } = walked;
    let module = *index;
    for func in std::mem::take(funcs) {
        for span in func.spans.iter().filter(|span| span.step == VALIDATION) {
            if let Some(&Op::Str(noted)) = func.op(span.value)
                && let [which, plan @ ..] = program.strs.get(noted)
            {
                found.validations.push(Validation { start: span.start, end: span.end, which: which - b'0', plan: plan.to_vec() });
            }
        }
        let entered = entered_slots(program, func);
        let members = entered_members(program, func);
        let calls = entered_calls(program, func);
        let rechecked: FxHashMap<V, V> = (func.blocks.iter().flat_map(|block| &block.ops))
            .filter_map(|&later| match func.op(later) {
                Some(&Op::Coerce { value, .. }) => Some((value, later)),
                _ => None,
            })
            .collect();
        let path = &found.path;
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
        let joins: rustc_hash::FxHashSet<(u32, u32)> = (func.blocks.iter().skip(1).flat_map(|block| &block.params)).filter_map(|joined| spans.get(joined)).map(|whole| (whole.start, whole.end)).collect();
        let first_chain = chains_of_module.len();
        let mut chain_of: FxHashMap<V, usize> = FxHashMap::default();
        let mut lacking: Vec<String> = Vec::new();
        for block in &func.blocks {
            for &v in &block.ops {
                let pos = func.values[v.idx()].pos;
                if pos == 0 {
                    continue;
                }
                for (row, at, passing) in rules(program, func, v, &spans, &operands, linked) {
                    let line = step(pos, row.kind, row.what, &[&row.rest[..], if is_linked { "" } else { ",\"unsure\":2" }].concat(), None);
                    if let Some(at) = at {
                        chains_of_module.push(Chain { start: at.start, end: at.end, step: 0, passes: passing, integer_range: None, steps: vec![(v, line)] });
                    }
                }
                if is_linked
                    && let Some(&(Op::PropSet { obj, .. } | Op::ElemSet { obj, .. })) = func.op(v)
                    && let Some(at) = operands.get(&(v, RECEIVER))
                    && (program.tys.get(func.ty(obj)).any_object || program.tys.get(func.ty(obj)).parts.is_empty())
                {
                    chains_of_module.push(Chain { start: at.start, end: at.end, step: 0, passes: class::ALL | class::TAGGED | class::ARRAY | class::STORES_THROUGH_UNTYPED, integer_range: Some(FULL_INT32_RANGE), steps: Vec::new() });
                }
                if is_linked
                    && let Some(&Op::ElemGet { obj, key }) = func.op(v)
                    && let Some(at) = spans.get(&v)
                    && at.step == 0
                {
                    let (read_of, by) = (program.tys.get(func.ty(obj)), program.tys.get(func.ty(key)));
                    let is_array_element = !read_of.parts.is_empty() && !read_of.any_object && !read_of.any_function && read_of.prims & !prim::NULLISH == 0 && read_of.ints.is_none() && read_of.parts.iter().all(|part| matches!(part, Part::Array(_)));
                    let has_numeric_key = !by.has_objects() && by.prims & !(prim::NUMBER | prim::NULLISH) == 0 && (by.prims & prim::NUMBER != 0 || by.ints.is_some());
                    if is_array_element && has_numeric_key {
                        chains_of_module.push(Chain { start: at.start, end: at.end, step: 0, passes: class::ALL | class::TAGGED | class::ARRAY | class::READS_ARRAY_ELEMENT, integer_range: Some(FULL_INT32_RANGE), steps: Vec::new() });
                    }
                }
                let Some(mut coercion_site) = coercion_site(program, func, v, is_linked, linked) else { continue };
                if is_linked
                    && let Some(span) = spans.get(&v)
                    && let Some(joined) = block_param_receiving(func, v, &block.term)
                {
                    if func.ty(joined) != coercion_site.to && spans.get(&joined).is_some_and(|whole| (whole.start, whole.end) == (span.start, span.end)) {
                        if coercion_site.result != coercion_site.to || func.ty(joined).is_none() {
                            continue;
                        }
                        (coercion_site.to, coercion_site.result) = (func.ty(joined), func.ty(joined));
                    }
                }
                let linked = linked.filter(|_| {
                    coercion_site.from.is_none() || func.ty(coercion_site.from).is_none() || may_be_untyped_object(program, program.tys.get(func.ty(coercion_site.from))) || narrows_records(program, program.tys.get(func.ty(coercion_site.from)), program.tys.get(coercion_site.to))
                });
                let mut line = String::from(",\"to\":");
                write_type(program, &mut line, coercion_site.to, 0, linked);
                if coercion_site.result != coercion_site.to {
                    line.push_str(",\"result\":");
                    write_type(program, &mut line, coercion_site.result, 0, linked);
                }
                if coercion_site.text.is_some() {
                    line.push_str(",\"text\":");
                    quoted(&mut line, program.strs.get(coercion_site.text));
                }
                if let Some(member) = members.get(&v) {
                    line.push_str(",\"on\":");
                    quoted(&mut line, member.as_bytes());
                }
                for (i, behind) in conversions_feeding(func, v).into_iter().enumerate() {
                    let (line_of_it, column) = lines[module].as_ref().map_or((0, behind as usize), |lines| lines.line_and_column(behind));
                    let _ = write!(line, "{}\"{line_of_it}:{column}\"", if i == 0 { ",\"after\":[" } else { "," });
                }
                if !conversions_feeding(func, v).is_empty() {
                    line.push(']');
                }
                if coercion_site.is_known_only_at_link {
                    line.push_str(",\"unsure\":2");
                } else if !is_linked && coercion_site.what != "NonNull" {
                    line.push_str(",\"unsure\":1");
                }
                let kind = kind_of(program, func, v, &entered);
                let mut entering = v;
                while !calls.contains_key(&entering)
                    && let Some(&next) = rechecked.get(&entering)
                {
                    entering = next;
                }
                if let (Some(&(call, index)), Some(lines)) = (calls.get(&entering), lines[module].as_ref())
                    && call != 0
                {
                    let (line_of_call, column_of_call) = lines.line_and_column(call);
                    let _ = write!(line, ",\"callId\":\"{}\"", id_of(path, line_of_call, column_of_call, Kind::EnterArgument.as_str(), index));
                }
                let line = step(pos, kind, &coercion_site.what, &line, None);
                let Some(&span) = spans.get(&v) else {
                    lacking.push(line);
                    continue;
                };
                let passing = match &*coercion_site.what {
                    "IteratorOpen" => prim::NULLISH,
                    "Coerce" => passes(program, program.tys.get(coercion_site.to), linked) | passes(program, program.tys.get(coercion_site.result), linked),
                    _ => passes(program, program.tys.get(coercion_site.to), linked),
                };
                let chains = &mut *chains_of_module;
                let earlier = (chain_of.get(&coercion_site.from).copied())
                    .filter(|&chain| span.start <= chains[chain].start && chains[chain].end <= span.end && chains[chain].step == span.step)
                    .filter(|&chain| (chains[chain].start, chains[chain].end) == (span.start, span.end) || !joins.contains(&(span.start, span.end)));
                let chain = earlier.unwrap_or_else(|| {
                    chains.push(Chain { start: span.start, end: span.end, step: span.step, passes: class::ALL | class::TAGGED | class::ARRAY, integer_range: Some(FULL_INT32_RANGE).filter(|_| span.step == 0), steps: Vec::new() });
                    chains.len() - 1
                });
                (chains[chain].start, chains[chain].end) = (span.start, span.end);
                chains[chain].passes &= passing;
                chains[chain].integer_range = if &*coercion_site.what == "IteratorOpen" { None } else { integer_range_within(chains[chain].integer_range, program.tys.get(coercion_site.to)) };
                chains[chain].steps.push((v, line));
                chain_of.insert(v, chain);
            }
        }
        for chain in &mut chains_of_module[first_chain..] {
            chain.steps.sort_by_key(|step| step.0);
        }
        let mut parameters: Vec<Parameter> = Vec::new();
        let is_entered_by_untyped_clone = func.kind == crate::ir::FuncKind::Method && entered_by_untyped_clone.contains(&(module, func.pos));
        let has_untyped_clone = is_linked && (is_entered_by_untyped_clone || matches!(bodies_at.get(&(module, func.pos)), Some(&(true, bodies)) if bodies >= 2));
        if has_untyped_clone || !is_entered_by_untyped_clone && (!is_linked || func.has(func_flags::IS_VALUE) || func.kind == crate::ir::FuncKind::Method) {
            let body = func.spans.iter().find(|span| span.value.is_none() && span.step > STORED);
            let first = func.captures.len() + usize::from(func.has(func_flags::HAS_THIS));
            let entry = func.blocks.first().map_or(&[][..], |block| &block.params[..]);
            let ahead = usize::from(func.kind == crate::ir::FuncKind::Constructor && func.has(func_flags::HAS_NEW_TARGET));
            let is_used = used_values(func);
            for (place, &param) in func.params.iter().enumerate() {
                let Some(&v) = entry.get(first + place) else { break };
                let index = place.saturating_sub(ahead);
                if !has_untyped_clone && !is_used[v.idx()] && !(func.has(func_flags::HAS_REST) && place + 1 == func.params.len()) {
                    continue;
                }
                if param.is_none() || param == program.tys.anything || func.has(func_flags::IS_HIDDEN_IN_STACK_TRACES | func_flags::IS_MODULE_BODY) {
                    continue;
                }
                let mut rest = format!(",\"index\":{index},\"to\":");
                write_type(program, &mut rest, param, 0, None);
                let takes = program.tys.get(param);
                let holds = is_linked && !takes.any_object && (takes.any_function || !takes.parts.is_empty()) && takes.parts.iter().all(|part| matches!(part, Part::Global(..) | Part::Array(_)));
                if holds {
                    rest.push_str(",\"holds\":true");
                }
                if has_untyped_clone {
                    if !func.annotated.get(place).copied().unwrap_or(false) {
                        continue;
                    }
                    rest.push_str(",\"second\":1");
                }
                if !is_linked {
                    rest.push_str(if func.has(func_flags::IS_VALUE) || func.kind == crate::ir::FuncKind::Method { ",\"unsure\":1" } else { ",\"unsure\":2" });
                }
                let step = step(func.pos, Kind::EnterFunction, "As", &rest, Some(index as u32));
                let (Some(body), Some(span)) = (body, spans.get(&v)) else { continue };
                let declared = program.tys.get(param);
                let objects = if has_untyped_clone {
                    class::HAS_UNTYPED_CLONE
                } else if declared.has_objects() && !holds {
                    class::OBJECT | class::FUNCTION
                } else {
                    0
                };
                parameters.push(Parameter { function: body.step as u32, index: index as u32, start: span.start, end: span.end, body: (body.start, body.end), passes: (passes(program, declared, None) & !(if holds && !declared.any_function { class::FUNCTION } else { 0 })) | objects, least: to_int32_range(integer_range_within(Some(FULL_INT32_RANGE), declared)).0, most: to_int32_range(integer_range_within(Some(FULL_INT32_RANGE), declared)).1, step });
            }
        }
        found.without_span.append(&mut lacking);
        found.parameters.append(&mut parameters);
    }
    let mut chains = std::mem::take(chains_of_module);
    chains.sort_by_key(|chain| (chain.start, std::cmp::Reverse(chain.end), chain.step));
    let mut seen: Vec<String> = Vec::new();
    let mut key = None;
    for chain in chains {
        if key != Some((chain.start, chain.end, chain.step)) {
            key = Some((chain.start, chain.end, chain.step));
            seen.clear();
            found.groups.push(Group { start: chain.start, end: chain.end, step: chain.step, passes: class::ALL | class::TAGGED | class::ARRAY, least: i32::MIN, most: i32::MAX, steps: String::new() });
        }
        let group = found.groups.last_mut().expect("one was pushed");
        group.passes = (group.passes & chain.passes) | ((group.passes | chain.passes) & (class::READS_ARRAY_ELEMENT | class::STORES_THROUGH_UNTYPED));
        let (least, most) = to_int32_range(chain.integer_range);
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
    found.parameters.sort_by_key(|parameter| (parameter.function, parameter.index));
    found.parameters.dedup_by_key(|parameter| (parameter.function, parameter.index));
}

pub fn fragment_program(fragment: crate::fragment::Fragment, shown_from: &[u8], is_case_sensitive: bool, line_table_of: &dyn Fn(&[u8]) -> Vec<u8>) -> Program {
    use crate::id::{FuncId, LayoutId, StrId};
    let crate::fragment::Fragment { path, strs, tys, modules, layouts, funcs, .. } = fragment;
    let mut program = Program { strs, tys, ..Program::default() };
    widen_layoutless_classes_to_any_object(&mut program);
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
                accepts_untyped: false,
                is_relaxed_for_logging: false,
                accepts_only_other_layouts: false,
                members: Vec::new(),
                structural_subtypes: Vec::new(),
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
                source_start: 0,
                source_end: 0,
                kind: crate::ir::FuncKind::Plain,
                flags: 0,
                length: 0,
                captures: Vec::new(),
                declared_this_type: TyId::NONE,
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
        if let Some(length) = module.source_len {
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
    fn lines_round_trip() {
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
    fn id_is_folded_hash() {
        assert_eq!(id_of(b"h01_audit.ts", 3, 19, "read-property", 0), "ad8cb700bf69");
    }
}
