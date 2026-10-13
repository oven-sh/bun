//! `--aot-explain=literals`: how the object literals of the program are made, and what stands in the way where one is not made as the type it stands under. In numbers alone.

use super::{FileBuild, Fx};
use crate::id::{LayoutId, StrId, V};
use crate::declared::Part;
use crate::ir::{Op, Program, Why, field_flags};
use bun_sema::hir::{ExprId, FileKind, PropId, PropKey, PropKind, Span};
use bun_sema::program::FileId;
use bun_sema::types::{Origin, PropFlags, TypeData, TypeId};

const AS_ITS_TYPE: usize = 0;
const UNDER_NO_TYPE: usize = 1;
const UNDER_NO_TYPE_NOT_PLAIN: usize = 2;
const NOT_TYPED: usize = 3;
const ONLY_COPIED_FROM: usize = 4;
const ASSIGNED_ONTO: usize = 5;
const ASKED_TO_BE_DYNAMIC: usize = 6;
const COERCED_TO_MORE: usize = 7;
const AGAINST_WHAT_IS_INFERRED: usize = 8;
const ODD_KEY: usize = 9;
const COMPUTED_KEY: usize = 10;
const ACCESSOR: usize = 11;
const SPREAD_SUPPLIES_REQUIRED: usize = 12;
const WRITTEN_BEHIND_SPREAD_REQUIRED: usize = 13;
const SPREAD_NOT_HELD: usize = 14;
const WRITTEN_NOT_HELD: usize = 15;
const COPY_SEEN_AS_ITS_TYPE: usize = 16;
const COPY_LACKS_REQUIRED: usize = 17;
const COPY_HAS_MORE: usize = 18;
const COPY_OTHERWISE: usize = 19;
const SPREAD_OTHERWISE: usize = 20;
const EXCESS_BY_INDEX_SIGNATURE: usize = 21;
const EXCESS_FOR_ANOTHER_MEMBER: usize = 22;
const EXCESS_ALLOWED: usize = 23;
const EXCESS_OTHERWISE: usize = 24;
const REQUIRED_MEMBER_MISSING: usize = 25;
const SEVERAL_FIT: usize = 26;
const OTHERWISE: usize = 27;
const COPY_MAY_BE_NIL: usize = 28;
const COPY_OF_SEVERAL: usize = 29;
const COPY_UNDER_SEVERAL: usize = 30;
const COPY_NOT_SEEN: usize = 31;
/// From here on: by `BLOCKS`, by `KINDS`.
const WITHOUT_LAYOUT: usize = 32;

/// By the numbers above. `T`: the type that the literal stands under.
const WAYS: [&str; WITHOUT_LAYOUT] = [
    "MADE AS T",
    "under no type that says what its properties are",
    "under no type that says what its properties are, with a spread or a computed key",
    "in a file that is not typed",
    "only copied from: the operand of a spread, an argument of Object.assign",
    "assigned onto: the first argument of Object.assign, Object.defineProperties",
    "asked to be dynamic: `any` is written above it",
    "`{ .. } as T`, `satisfies T`: no T by itself",
    "T is what the checker has put in for a type parameter, and a value is `any`",
    "`__proto__`, or a key that is no name",
    "a computed key",
    "an accessor or a method beside a spread, or an accessor under the name of a field of T",
    "a spread supplies members that T requires",
    "a member that T requires is written behind a spread",
    "a spread of a property that T has no field for or does not provably hold",
    "beside a spread: a written member that T has no field for or does not provably hold",
    "a copy of what is spread first, which is seen as T",
    "a spread comes first: what it copies lacks members that T requires (a copy that is extended)",
    "a spread comes first: what it copies has members that T has no field for",
    "a spread comes first: what it copies is not seen as T for another reason",
    "a spread: another reason",
    "a member that T has no field for: T has an index signature besides its properties",
    "a member that T has no field for: T is a union, and a member of it that has no layout takes the literal",
    "a member that T has no field for: the literal is a T with more members, and nothing checks for those there",
    "a member that T has no field for: another reason",
    "a member that T requires is missing",
    "T is a union, and several of its members fit",
    "another reason",
    "a spread comes first: its operand may be nil",
    "a spread comes first: its operand is one of several records",
    "a spread comes first: T is a union, and the copy with what is written fits several of its members or none",
    "a spread comes first: what it copies has the fields and the required members, and its type is not seen as T",
];

const DIRECTLY: usize = 0;
const IN_INTERSECTION: usize = 1;
const IN_MAPPED: usize = 2;
const SPREAD: usize = 3;
const BLOCKS: [&str; 4] = ["T has no layout: ", "T has no layout: an intersection with ", "T has no layout: Record, Partial, Pick, .. of the standard library, of ", "a spread of what has no layout: "];

const OF_CLASS: usize = 0;
const OF_LIBRARY: usize = 1;
const OF_JSON: usize = 2;
const OF_UNTYPED_FILE: usize = 3;
const AMBIENT_IN_DECLARATION_FILE: usize = 4;
const AMBIENT_IN_PROGRAM: usize = 5;
const DICTIONARY: usize = 6;
const CALLABLE: usize = 7;
const GENERIC: usize = 8;
const MAPPED_BY_DECLARATION_FILE: usize = 9;
const MAPPED_BY_PROGRAM: usize = 10;
const SAYS_NOTHING: usize = 11;
const OF_ENGINE: usize = 12;
const ODD_PROPERTY: usize = 13;
const EMPTY: usize = 14;
const PRIMITIVE: usize = 15;
const UNKNOWN_KIND: usize = 16;
const NESTED_TOO_DEEPLY: usize = 17;
const WITH_ACCESSOR: usize = 18;
const WITH_SYMBOL: usize = 19;
const WITH_INDEX: usize = 20;
/// By `Checker::counter_nested_too_deeply`.
const NESTED: [usize; 8] = [NESTED_TOO_DEEPLY, 21, 22, 23, 24, 25, 26, 27];
const KINDS: [&str; 28] = [
    "the objects of a class",
    "what the standard library writes",
    "what a JSON file holds",
    "what a file that is not typed writes",
    "an interface all of whose declarations are ambient, in a declaration file",
    "an interface all of whose declarations are ambient, in the program's own files",
    "a dictionary: an index signature and no property",
    "what can be called or constructed",
    "a type parameter, or what depends on one",
    "a mapped type that a declaration file writes: a package's generic",
    "a mapped type that the program writes, of what is not the program's",
    "`any`, `unknown`, `object`, `{}`",
    "an array, a tuple, what extends a kind of the engine",
    "what has `__proto__` among its properties",
    "what has no property",
    "a string",
    "another kind",
    "what is nested too deeply: a generic class or interface is applied too often within its own type arguments",
    "what has an accessor among its properties",
    "what has a symbol or a private name among its properties",
    "what has an index or the empty name among its properties",
    "what is nested too deeply: a type that is written where type parameters are in scope is applied too often within its own type arguments",
    "what is nested too deeply: a function type is applied too often within its own type arguments",
    "what is nested too deeply: what is computed refers too often to what is computed",
    "what is nested too deeply: tuples within tuples, or a long one",
    "what is nested too deeply: it refers to the type of a long text",
    "what is nested too deeply: a generic alias is applied too often within its own type arguments",
    "what is nested too deeply: a conditional type, an indexed access or a string mapping that waits for a type parameter is applied too often to its like",
];

const ROWS: usize = WITHOUT_LAYOUT + BLOCKS.len() * KINDS.len();

fn text_of(way: usize) -> String {
    match way.checked_sub(WITHOUT_LAYOUT) {
        None => WAYS[way].to_string(),
        Some(within) => format!("{}{}", BLOCKS[within / KINDS.len()], KINDS[within % KINDS.len()]),
    }
}

/// `counted`: of each fragment, whether it is of the runtime, and `Fragment::literals`.
pub(crate) fn explain<'a>(counted: impl Iterator<Item = (bool, &'a [[u32; 2]])>) -> Vec<String> {
    let mut sums = [[[0u64; 2]; ROWS]; 2];
    for (is_of_runtime, counts) in counted {
        for (sum, count) in sums[usize::from(is_of_runtime)].iter_mut().zip(counts) {
            sum[0] += u64::from(count[0]);
            sum[1] += u64::from(count[1]);
        }
    }
    let mut lines = Vec::new();
    for (whose, sums) in ["the program", "the modules of the runtime"].into_iter().zip(sums) {
        let all: u64 = sums.iter().map(|sum| sum[0] + sum[1]).sum();
        if all == 0 {
            continue;
        }
        let under_a_type: u64 = sums.iter().enumerate().filter(|&(way, _)| !matches!(way, UNDER_NO_TYPE | UNDER_NO_TYPE_NOT_PLAIN | NOT_TYPED | ONLY_COPIED_FROM)).map(|(_, sum)| sum[0] + sum[1]).sum();
        let with_layout: u64 = sums.iter().map(|sum| sum[0]).sum();
        let share = |part: u64, whole: u64| if whole == 0 { 0.0 } else { 100.0 * part as f64 / whole as f64 };
        lines.push(format!(
            "literals: {whose}: {all} object literals; {with_layout} ({:.1}%) are made with a layout; {under_a_type} stand under a type T, {} ({:.1}%) of them are made as T",
            share(with_layout, all),
            sums[AS_ITS_TYPE][0],
            share(sums[AS_ITS_TYPE][0], under_a_type)
        ));
        lines.push(format!("literals: {whose}: with another layout | an ordinary object | what stands in the way, the first that applies"));
        let mut rows: Vec<usize> = (1..ROWS).filter(|&way| sums[way] != [0, 0]).collect();
        rows.sort_by_key(|&way| std::cmp::Reverse(sums[way][0] + sums[way][1]));
        lines.extend(rows.into_iter().map(|way| format!("literals: {whose}: {:>8} | {:>8} | {}", sums[way][0], sums[way][1], text_of(way))));
    }
    lines
}

/// The births that go through an ordinary object, in the program as it is in the end: `NewObject` or `CloneObject`, then a cast that makes an object with a layout of it: two allocations and a walk for one
/// birth. By what is done to the object in between, and whether all of it stands in one block.
pub(crate) fn explain_births(program: &Program) -> Vec<String> {
    const KINDS: [&str; 4] = ["built member by member", "built with a spread behind or between the members", "a copy of what is spread first, and nothing else", "a copy of what is spread first, with members or spreads behind it"];
    let names = [&b"CloneObject"[..], b"CopyDataProperties"].map(|name| program.strs.find(name));
    let mut counts = [[0u32; 2]; KINDS.len()];
    for func in &program.funcs {
        let mut block_of: Vec<u32> = vec![u32::MAX; func.values.len()];
        let mut touched: Vec<u8> = vec![0; func.values.len()];
        for (index, block) in func.blocks.iter().enumerate() {
            for &v in &block.ops {
                block_of[v.idx()] = index as u32;
                match func.op(v) {
                    Some(Op::Operation { name, args }) if Some(*name) == names[1] && !args.is_empty() => touched[args[0].idx()] |= 2,
                    Some(Op::Operation { args, .. }) if !args.is_empty() => touched[args[0].idx()] |= 1,
                    Some(&Op::PropSet { obj, .. } | &Op::ElemSet { obj, .. }) => touched[obj.idx()] |= 1,
                    _ => {}
                }
            }
        }
        for (index, block) in func.blocks.iter().enumerate() {
            for &v in &block.ops {
                let Some(&Op::Coerce { value, to, why: Why::Cast }) = func.op(v) else { continue };
                if to.is_none() || !program.tys.get(to).parts.iter().any(|part| matches!(part, Part::Class(_))) {
                    continue;
                }
                let kind = match func.op(value) {
                    Some(Op::NewObject) => usize::from(touched[value.idx()] & 2 != 0),
                    Some(Op::Operation { name, .. }) if Some(*name) == names[0] => 2 + usize::from(touched[value.idx()] != 0),
                    _ => continue,
                };
                counts[kind][usize::from(block_of[value.idx()] != index as u32)] += 1;
            }
        }
    }
    let all: u32 = counts.iter().map(|count| count[0] + count[1]).sum();
    let mut lines = vec![format!("literals: births through an ordinary object (an object is built or copied, then a cast makes one with a layout of it): {all} places; in one block | over several blocks | how")];
    lines.extend(KINDS.iter().zip(counts).map(|(kind, count)| format!("literals: births: {:>8} | {:>8} | {kind}", count[0], count[1])));
    lines
}

pub(crate) fn sizes_of_sets_of_strings(program: &Program) -> (Vec<Vec<V>>, Vec<String>) {
    use crate::declared::prim;
    let size = program.strs.find(b"size");
    let mut marked_values = vec![Vec::new(); program.funcs.len()];
    let names_of_collections = [b"Set".as_slice(), b"ReadonlySet"].map(|name| program.strs.find(name));
    let mut remarks_on_sizes = Vec::new();
    for (index, func) in program.funcs.iter().enumerate() {
        for block in &func.blocks {
            for &v in &block.ops {
                if let Some(&Op::PropGet { obj, name }) = func.op(v)
                    && Some(name) == size
                    && let [crate::declared::Part::Global(global, arguments)] = &program.tys.get(func.ty(obj)).parts[..]
                    && names_of_collections.contains(&Some(*global))
                    && let Some(&key) = arguments.first()
                    && let key = program.tys.get(key)
                    && key.prims & prim::STRING != 0
                    && key.prims & !(prim::STRING | prim::NULLISH) == 0
                    && key.parts.is_empty()
                    && key.ints.is_none()
                    && !key.any_object
                    && !key.any_function
                {
                    marked_values[index].push(v);
                    let text = |name: StrId| String::from_utf8_lossy(program.strs.get(name)).into_owned();
                    let module = if func.module.is_none() { String::new() } else { text(program.modules[func.module.idx()].display_path) };
                    remarks_on_sizes.push(format!("literals: collections: size in {} ({module}): the keys are strings by the type", text(func.name)));
                }
            }
        }
    }
    (marked_values, remarks_on_sizes)
}

impl<'c, 'p, 's> FileBuild<'c, 'p, 's> {
    /// `made`: what `object_literal` has yielded for `e`.
    pub(crate) fn count_literal(&mut self, fx: &Fx, e: ExprId, props: Span<PropId>, made: V) {
        let ty = self.ty(fx, made);
        let made_with = if ty.is_some() { self.out.tys.get(ty).only_layout() } else { None };
        let way = self.way_of_literal(fx, e, props, made_with);
        if self.literals.is_empty() {
            self.literals = vec![[0; 2]; ROWS];
        }
        self.literals[way][usize::from(made_with.is_none())] += 1;
        let Some((name, line)) = self.shared.literal_at else { return };
        let (hir, start) = (self.hir(fx.file), self.hir(fx.file)[e].pos as usize);
        if !self.files.module(fx.file).file_name().ends_with(name.as_bytes()) || hir.text[..start].iter().filter(|&&byte| byte == b'\n').count() as u32 + 1 != line {
            return;
        }
        let column = start - hir.text[..start].iter().rposition(|&byte| byte == b'\n').map_or(0, |at| at + 1) + 1;
        let own = self.c.type_of_expr(fx.file, e);
        let (is_own_laid_out, parts) = (self.is_type_laid_out(own), self.c.parts(own).len());
        let under: Vec<TypeId> = self.c.contextual_type_of_literal(fx.file, e).map_or_else(Vec::new, |expected| self.c.parts(expected).to_vec());
        let nesting: String = under.iter().map(|&part| self.c.explain_nesting(part)).filter(|way| !way.is_empty()).map(|way| format!("; THE WAY INWARDS: {way}")).collect();
        let under = under.len();
        self.literals_shown.push(format!(
            "literal: {line}:{column}: v{} in `{}`: {}: {}; its own type: {parts} part(s), {}; the type it stands under: {under} part(s){nesting}",
            made.0,
            String::from_utf8_lossy(self.out.strs.get(self.out.funcs[fx.id.idx()].name)),
            if made_with.is_some() { "made with a layout" } else { "an ordinary object" },
            text_of(way),
            if is_own_laid_out { "laid out" } else { "NOT laid out" },
        ));
    }

    fn way_of_literal(&mut self, fx: &Fx, e: ExprId, props: Span<PropId>, made_with: Option<LayoutId>) -> usize {
        let hir = self.hir(fx.file);
        if self.is_untyped_file(fx.file) || !fx.is_typed {
            return NOT_TYPED;
        }
        let has_spread = props.iter().any(|p| hir[p].kind == PropKind::Spread);
        let has_computed_key = props.iter().any(|p| matches!(hir[p].key, PropKey::Computed(_)));
        if self.is_only_copied_from(fx, e) {
            return ONLY_COPIED_FROM;
        }
        let expected = self.c.contextual_type_of_literal(fx.file, e).filter(|&expected| self.ty_of(expected) != self.out.tys.anything);
        let described: Vec<TypeId> = expected.map_or_else(Vec::new, |expected| self.c.parts(expected).iter().copied().filter(|&part| self.says_what_the_properties_are(part)).collect());
        let Some(expected) = expected.filter(|_| !described.is_empty()) else {
            return if has_spread || has_computed_key { UNDER_NO_TYPE_NOT_PLAIN } else { UNDER_NO_TYPE };
        };
        let mut laid_out: Vec<(TypeId, LayoutId)> = Vec::new();
        for &part in &described {
            if self.is_object_type_of_program(part)
                && let Some(layout) = self.record_layout(part)
            {
                laid_out.push((part, layout));
            }
        }
        if made_with.is_some_and(|made_with| laid_out.iter().any(|&(_, layout)| layout == made_with)) {
            return AS_ITS_TYPE;
        }
        if self.is_assigned_onto(fx, e) {
            return ASSIGNED_ONTO;
        }
        if self.is_asked_to_be_dynamic(fx, e) {
            return ASKED_TO_BE_DYNAMIC;
        }
        if self.is_coerced_to_more(fx, e, expected) {
            return COERCED_TO_MORE;
        }
        if self.c.is_checked_against_what_is_inferred(fx.file, e, expected) {
            return AGAINST_WHAT_IS_INFERRED;
        }
        if laid_out.is_empty() {
            let (block, kind) = self.why_without_layout(described[0]);
            return WITHOUT_LAYOUT + block * KINDS.len() + kind;
        }
        if has_computed_key {
            return COMPUTED_KEY;
        }
        let is_odd = |b: &Self, p: PropId| hir[p].kind != PropKind::Spread && !matches!(hir[p].key, PropKey::Name(name) if b.c.atoms().bytes(name) != b"__proto__");
        if props.iter().any(|p| is_odd(self, p)) {
            return ODD_KEY;
        }
        let written: Vec<StrId> = props.iter().filter(|&p| !matches!(hir[p].kind, PropKind::Spread | PropKind::Getter | PropKind::Setter)).filter_map(|p| hir[p].key.name()).map(|name| self.str(name)).collect();
        let has_field_for_each = |b: &Self, layout: LayoutId, names: &[StrId]| names.iter().all(|&name| b.out.layouts[layout.idx()].field(name).is_some());
        let has_all_required = |b: &Self, layout: LayoutId, names: &[StrId]| b.out.layouts[layout.idx()].fields.iter().all(|field| field.flags & field_flags::OPTIONAL != 0 || names.contains(&field.name));
        if !has_spread {
            if props.iter().any(|p| matches!(hir[p].kind, PropKind::Getter | PropKind::Setter)) {
                return ACCESSOR;
            }
            let with_fields: Vec<LayoutId> = laid_out.iter().map(|&(_, layout)| layout).filter(|&layout| has_field_for_each(self, layout, &written)).collect();
            if with_fields.is_empty() {
                for &(part, _) in &laid_out {
                    if self.c.members(part).is_some_and(|members| !members.shape().index.is_empty()) {
                        return EXCESS_BY_INDEX_SIGNATURE;
                    }
                }
                if described.len() > laid_out.len() {
                    return EXCESS_FOR_ANOTHER_MEMBER;
                }
                let own = self.c.type_of_expr(fx.file, e);
                let is_one = laid_out.iter().any(|&(part, _)| self.c.is_provably_assignable(own, part));
                return if is_one { EXCESS_ALLOWED } else { EXCESS_OTHERWISE };
            }
            let mut fitting: Vec<LayoutId> = with_fields.into_iter().filter(|&layout| has_all_required(self, layout, &written)).collect();
            fitting.dedup();
            return match fitting.len() {
                0 => REQUIRED_MEMBER_MISSING,
                1 => OTHERWISE,
                _ => SEVERAL_FIT,
            };
        }
        if props.iter().any(|p| matches!(hir[p].kind, PropKind::Method | PropKind::Getter | PropKind::Setter)) {
            return ACCESSOR;
        }
        let spreads: Vec<ExprId> = props.iter().filter(|&p| hir[p].kind == PropKind::Spread).map(|p| hir[p].value).collect();
        let mut supplied = written.clone();
        for &operand in &spreads {
            let spread = self.c.type_of_expr(fx.file, operand);
            for &part in self.c.parts(spread) {
                if self.has_nothing_to_copy(part) {
                    continue;
                }
                if !self.is_object_type_of_program(part) || self.record_layout(part).is_none() {
                    return WITHOUT_LAYOUT + SPREAD * KINDS.len() + self.why_without_layout(part).1;
                }
                let Some(members) = self.c.members(part) else { return SPREAD_OTHERWISE };
                let certain: Vec<_> = members.shape().props.iter().filter(|prop| !prop.flags.contains(PropFlags::OPTIONAL)).map(|prop| prop.name).collect();
                if self.c.parts(spread).len() == 1 {
                    supplied.extend(certain.into_iter().map(|name| self.str(name)));
                }
            }
        }
        let first = props.iter().next().filter(|&first| hir[first].kind == PropKind::Spread);
        if first.is_some() && made_with.is_some() {
            return COPY_SEEN_AS_ITS_TYPE;
        }
        if let Some(first) = first {
            let copied = self.c.type_of_expr(fx.file, hir[first].value);
            if self.c.parts(copied).len() > 1 {
                return if self.c.parts(copied).iter().any(|part| part.is_undefined() || part.is_null()) { COPY_MAY_BE_NIL } else { COPY_OF_SEVERAL };
            }
            let Some(copy) = self.record_layout(copied) else { return COPY_OTHERWISE };
            let names: Vec<StrId> = self.out.layouts[copy.idx()].fields.iter().map(|field| field.name).collect();
            if !laid_out.iter().any(|&(_, layout)| has_field_for_each(self, layout, &names)) {
                return COPY_HAS_MORE;
            }
            if !laid_out.iter().any(|&(_, layout)| has_all_required(self, layout, &names)) {
                return COPY_LACKS_REQUIRED;
            }
        } else {
            let ahead: Vec<StrId> = props.iter().take_while(|&p| hir[p].kind != PropKind::Spread).filter_map(|p| hir[p].key.name()).map(|name| self.str(name)).collect();
            if !laid_out.iter().any(|&(_, layout)| has_all_required(self, layout, &ahead)) {
                return if laid_out.iter().any(|&(_, layout)| has_all_required(self, layout, &written)) {
                    WRITTEN_BEHIND_SPREAD_REQUIRED
                } else if laid_out.iter().any(|&(_, layout)| has_all_required(self, layout, &supplied)) {
                    SPREAD_SUPPLIES_REQUIRED
                } else {
                    REQUIRED_MEMBER_MISSING
                };
            }
        }
        let (base, layout) = laid_out[0];
        for p in props.iter() {
            let given = self.c.type_of_expr(fx.file, hir[p].value);
            match (hir[p].kind, hir[p].key) {
                (PropKind::Spread, _) if !self.is_spread_held_by(layout, base, given) => return SPREAD_NOT_HELD,
                (PropKind::Init | PropKind::Shorthand, PropKey::Name(name)) if !self.is_property_held_by(layout, base, name, given) => return WRITTEN_NOT_HELD,
                _ => {}
            }
        }
        let Some(first) = first else { return SPREAD_OTHERWISE };
        let copied = self.c.type_of_expr(fx.file, hir[first].value);
        let Some(copy) = self.record_layout(copied) else { return COPY_OTHERWISE };
        let names: Vec<StrId> = self.out.layouts[copy.idx()].fields.iter().map(|field| field.name).collect();
        let mut fitting: Vec<(TypeId, LayoutId)> = laid_out.iter().copied().filter(|&(_, layout)| self.fits(layout, &names)).collect();
        fitting.dedup_by_key(|fitting| fitting.1);
        match fitting[..] {
            [(target, layout)] if layout != copy && !self.c.is_seen_as(copied, target) => COPY_NOT_SEEN,
            [_] => COPY_OTHERWISE,
            _ => COPY_UNDER_SEVERAL,
        }
    }

    /// Not so of a primitive, nor of `any`, `unknown`, `object`, `{}`.
    fn says_what_the_properties_are(&mut self, part: TypeId) -> bool {
        !self.c.is_untyped(part) && (self.c.is_object_type(part) || matches!(self.c.data(part), TypeData::Intersection(_) | TypeData::TypeParam(..) | TypeData::Cond { .. } | TypeData::IndexedAccess { .. } | TypeData::Substitution { .. }))
    }

    fn kind_by_file(&self, file: FileId) -> Option<usize> {
        if self.files.module(file).is_lib {
            Some(OF_LIBRARY)
        } else if self.hir(file).kind == FileKind::Json {
            Some(OF_JSON)
        } else if self.is_untyped_file(file) {
            Some(OF_UNTYPED_FILE)
        } else {
            None
        }
    }

    /// Of a type that no object is made as: one of `BLOCKS` but the last, and one of `KINDS`.
    fn why_without_layout(&mut self, ty: TypeId) -> (usize, usize) {
        let is_dictionary = self.kind_without_layout(ty) == DICTIONARY;
        match self.c.data(ty) {
            TypeData::Intersection(parts) => {
                for &part in parts.iter() {
                    if !self.is_object_type_of_program(part) {
                        return (IN_INTERSECTION, self.kind_without_layout(part));
                    }
                }
            }
            TypeData::Anon { origin: Origin::Mapped(file, _), .. } if !is_dictionary && self.files.module(*file).is_lib => {
                for argument in self.c.alias_of_type(ty).map_or_else(Vec::new, |(_, arguments)| arguments) {
                    if argument.is_any() || argument == TypeId::UNKNOWN || self.c.is_object_type(argument) && !self.is_object_type_of_program(argument) {
                        return (IN_MAPPED, self.kind_without_layout(argument));
                    }
                }
            }
            _ => {}
        }
        (DIRECTLY, self.kind_without_layout(ty))
    }

    fn kind_without_layout(&mut self, ty: TypeId) -> usize {
        if matches!(self.c.data(ty), TypeData::TypeParam(..) | TypeData::ThisParam(_) | TypeData::Cond { .. } | TypeData::IndexedAccess { .. } | TypeData::Substitution { .. } | TypeData::Keyof(_)) {
            return GENERIC;
        }
        if self.c.is_untyped(ty) {
            return SAYS_NOTHING;
        }
        if self.c.is_type_of_instances(ty) {
            return OF_CLASS;
        }
        if self.c.is_object_type(ty)
            && let Some(members) = self.c.members(ty)
        {
            let shape = members.shape();
            if !shape.call.is_empty() || !shape.construct.is_empty() {
                return CALLABLE;
            }
            if shape.props.is_empty() {
                return if shape.index.is_empty() { EMPTY } else { DICTIONARY };
            }
        }
        if self.is_object_type_of_program(ty) {
            if let Some(counter) = self.c.counter_nested_too_deeply(ty) {
                return NESTED[counter];
            }
            let Some(members) = self.c.members(ty) else { return UNKNOWN_KIND };
            for prop in members.shape().props.iter() {
                let bytes = self.c.atoms().bytes(prop.name);
                if prop.flags.contains(PropFlags::ACCESSOR) {
                    return WITH_ACCESSOR;
                } else if bytes.first() == Some(&0xFE) {
                    return WITH_SYMBOL;
                } else if bytes == b"__proto__" {
                    return ODD_PROPERTY;
                } else if !Self::is_field_name(bytes) {
                    return WITH_INDEX;
                }
            }
            return UNKNOWN_KIND;
        }
        match self.c.data(ty) {
            TypeData::Tuple { .. } => OF_ENGINE,
            TypeData::Fns { .. } => CALLABLE,
            TypeData::Ref { target, .. } => {
                let target = *target;
                if self.c.is_array(ty) {
                    OF_ENGINE
                } else if let Some(kind) = self.kind_by_file(target.file) {
                    kind
                } else if self.c.is_ambient_interface(target) {
                    if self.hir(target.file).kind == FileKind::Declaration { AMBIENT_IN_DECLARATION_FILE } else { AMBIENT_IN_PROGRAM }
                } else {
                    OF_ENGINE
                }
            }
            TypeData::Anon { origin, .. } => match *origin {
                Origin::TypeLiteral(file, _) | Origin::ObjectLiteral(file, ..) | Origin::WidenedLiteral(file, ..) => self.kind_by_file(file).unwrap_or(UNKNOWN_KIND),
                Origin::Mapped(file, _) => self.kind_by_file(file).unwrap_or(if self.hir(file).kind == FileKind::Declaration { MAPPED_BY_DECLARATION_FILE } else { MAPPED_BY_PROGRAM }),
                Origin::Function(_) | Origin::ClassStatic(_) => CALLABLE,
                _ => UNKNOWN_KIND,
            },
            TypeData::Intrinsic(_) | TypeData::StringLit { .. } | TypeData::Template { .. } | TypeData::StringMapping { .. } => PRIMITIVE,
            _ => UNKNOWN_KIND,
        }
    }
}
