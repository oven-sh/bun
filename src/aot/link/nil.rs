//! Room for the `undefined` and the `null` that the types leave out.
//!
//! `bun_sema::check::given` says what gets where. Here it is told how values get from place to place in the linked program, and the places it names
//! are given the room: the types of values, parameters, results, fields and module variables. Nothing is worked out here.
//!
//! Along everything that is reported, what the one end may hold the other end may hold too, so the types still fit, but for a use behind a test: there the value
//! is narrowed to what the test has shown.

use crate::declared::{Declared, DeclaredTable, Part, prim};
use crate::id::{FuncId, LayoutId, StrId, TyId, V};
use crate::ir::{Def, Func, Layout, LayoutKind, MethodKind, Op, Prediction, Program, Strs, Target, Term, Why, class_flags, func_flags, method_flags, only_function_flags};
use bun_sema::check::given::{Jump, NO_JUMP, parameters_handed_elements, NULL, EdgesByNode, NilEdges, STRANGER, NilFlowsInFunction, Origin, PlaceEvent, UNDEFINED, Use, add_nil_flows_in, edges_by_node, nil_reaching, stored_values_read};
use bun_sema::util::{InParallel, for_each_mut};
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

const NIL: u8 = UNDEFINED | NULL;

/// How the values and the places of the program are numbered.
pub(super) struct Nodes {
    /// By function: its first value.
    values: Vec<u32>,
    /// That of the first function.
    pub(super) results: u32,
    /// The first.
    pub(super) globals: u32,
    /// By layout: its first field.
    fields: Vec<u32>,
    yielded: u32,
    pub(super) count: u32,
}

impl Nodes {
    pub(super) fn of(program: &Program) -> Nodes {
        let mut count = 0;
        let mut take = |many: usize| {
            let first = count;
            count += many as u32;
            first
        };
        let values = program.funcs.iter().map(|func| take(func.values.len())).collect();
        let results = take(program.funcs.len());
        let globals = take(program.globals.len());
        let fields = program.layouts.iter().map(|layout| take(layout.fields.len())).collect();
        let yielded = take(2);
        Nodes { values, results, globals, fields, yielded, count }
    }
    pub(super) fn value(&self, func: usize, v: V) -> u32 {
        self.values[func] + v.idx() as u32
    }
    pub(super) fn result(&self, func: usize) -> u32 {
        self.results + func as u32
    }
    pub(super) fn field(&self, layout: LayoutId, field: u32) -> u32 {
        self.fields[layout.idx()] + field
    }
}

/// The value as it was before it was held to types. `as` may make another of it.
pub(super) fn before_casts(func: &Func, mut v: V) -> V {
    while let Some(&Op::Coerce { value, why, .. }) = func.op(v)
        && why != Why::Coerce
    {
        v = value;
    }
    v
}

pub(super) fn targets_of(term: Option<&Term>) -> SmallVec<[&Target; 2]> {
    match term {
        Some(Term::Jump(target)) => SmallVec::from_iter([target]),
        Some(Term::Branch { then, otherwise, .. }) => SmallVec::from_iter([then, otherwise]),
        Some(Term::Switch { cases, default, .. }) => cases.iter().map(|case| &case.1).chain([default]).collect(),
        Some(Term::Throw { unwind, .. }) => unwind.iter().collect(),
        Some(Term::Invoke { normal, unwind }) => SmallVec::from_iter([normal, unwind]),
        Some(Term::Return(_) | Term::Unreachable) | None => SmallVec::new(),
    }
}

fn is_kept_unboxed(program: &Program, ty: TyId) -> bool {
    ty.is_some() && ty != program.tys.anything && !program.tys.get(ty).has_objects() && program.tys.get(ty).prims & prim::CELLS == 0 && !program.tys.get(ty).is_never()
}

fn kinds_kept_unboxed(program: &Program, ty: TyId) -> impl Iterator<Item = u32> {
    let is_unboxed = is_kept_unboxed(program, ty);
    let has_numbers = is_unboxed && (program.tys.get(ty).prims & prim::NUMBER != 0 || program.tys.get(ty).ints.is_some());
    let has_booleans = is_unboxed && program.tys.get(ty).prims & prim::BOOLEAN != 0;
    has_numbers.then_some(0).into_iter().chain(has_booleans.then_some(1))
}

fn may_reach_the_program(program: &Program, func: &Func, v: V) -> bool {
    let may_be_of_the_program = |obj: V| {
        let ty = func.ty(obj);
        !matches!(func.op(before_casts(func, obj)), Some(Op::FreeGet { .. }))
            && (ty.is_none() || ty == program.tys.anything || program.tys.get(ty).any_object || program.tys.get(ty).parts.iter().any(|part| matches!(part, Part::Class(_))))
    };
    match func.op(v) {
        Some(&Op::Call { callee, .. }) => match func.op(before_casts(func, callee)) {
            Some(Op::FreeGet { .. }) => false,
            Some(&Op::PropGet { obj, .. }) => may_be_of_the_program(obj),
            _ => true,
        },
        Some(&Op::CallMethod { obj, .. }) => may_be_of_the_program(obj),
        _ => false,
    }
}

struct Site {
    callees: SmallVec<[u32; 1]>,
    args: SmallVec<[(u32, TyId); 4]>,
    result: Option<u32>,
    is_of_the_engine: bool,
}

#[derive(Default)]
struct FunctionsAsValues {
    births: Vec<(u32, FuncId)>,
    moves: Vec<(u32, u32)>,
    sites: Vec<Site>,
    leaks: Vec<u32>,
    left_out: Vec<u32>,
    handed: Vec<u32>,
}

fn enter_where_functions_get(program: &Program, nodes: &Nodes, leaving: &EdgesByNode, found: Vec<FunctionsAsValues>) -> NilEdges {
    let mut more = NilEdges::default();
    let mut leaks = vec![false; nodes.count as usize];
    let mut sites: Vec<&Site> = Vec::new();
    let mut sites_at: FxHashMap<u32, SmallVec<[u32; 1]>> = FxHashMap::default();
    let mut pending: Vec<(FuncId, u32)> = Vec::new();
    let mut escaped: FxHashSet<FuncId> = FxHashSet::default();
    for part in &found {
        for &node in &part.leaks {
            leaks[node as usize] = true;
        }
        for site in &part.sites {
            for &callee in &site.callees {
                sites_at.entry(callee).or_default().push(sites.len() as u32);
            }
            sites.push(site);
        }
        pending.extend(part.births.iter().map(|&(node, function)| (function, node)));
    }
    let mut reached: FxHashMap<u32, SmallVec<[FuncId; 1]>> = FxHashMap::default();
    let mut added: FxHashMap<u32, SmallVec<[u32; 2]>> = FxHashMap::default();
    let mut joined: FxHashSet<(u32, FuncId)> = FxHashSet::default();
    let mut joins: Vec<(u32, u32)> = Vec::new();
    let mut is_joined = vec![false; sites.len()];
    let may_bring = |given: TyId, taken: TyId| {
        if !is_kept_unboxed(program, taken) || given.is_none() || given == program.tys.anything {
            return true;
        }
        let (given, taken) = (program.tys.get(given), program.tys.get(taken));
        let has_numbers = |it: &Declared| it.prims & prim::NUMBER != 0 || it.ints.is_some();
        given.prims & !prim::NULLISH == 0 && given.ints.is_none() && !given.has_objects() || has_numbers(given) && has_numbers(taken) || given.prims & taken.prims & prim::BOOLEAN != 0
    };
    loop {
        while let Some((function, node)) = pending.pop() {
            let here = reached.entry(node).or_default();
            if here.contains(&function) {
                continue;
            }
            here.push(function);
            let mut gone: SmallVec<[FuncId; 1]> = leaks[node as usize].then_some(function).into_iter().collect();
            while let Some(function) = gone.pop() {
                if escaped.insert(function) {
                    let result = nodes.result(function.idx());
                    leaks[result as usize] = true;
                    gone.extend(reached.get(&result).into_iter().flatten().copied());
                }
            }
            for &number in sites_at.get(&node).into_iter().flatten() {
                if !joined.insert((number, function)) {
                    continue;
                }
                is_joined[number as usize] = true;
                let (site, called) = (sites[number as usize], &program.funcs[function.idx()]);
                let Some(entered) = called.blocks.first() else { continue };
                let ahead = entered.params.len().saturating_sub(called.params.len());
                for (number, &parameter) in entered.params.iter().skip(ahead).enumerate() {
                    let to = nodes.value(function.idx(), parameter);
                    match site.args.get(number) {
                        Some(&(u32::MAX, _)) => {}
                        Some(&(from, given)) if may_bring(given, called.params[number]) => joins.push((from, to)),
                        Some(_) => {}
                        None => more.origins.push((to, UNDEFINED)),
                    }
                }
                if let Some(result) = site.result.filter(|_| !called.has(func_flags::ASYNC | func_flags::GENERATOR)) {
                    joins.push((nodes.result(function.idx()), result));
                }
            }
            for (from, to) in joins.drain(..) {
                more.edges.push((from, to, UNDEFINED));
                added.entry(from).or_default().push(to);
                pending.extend(reached.get(&from).into_iter().flatten().map(|&carried| (carried, to)));
            }
            pending.extend(leaving.other[leaving.at(node)].iter().map(|&to| (function, to)));
            pending.extend(added.get(&node).into_iter().flatten().map(|&to| (function, to)));
        }
        for (number, site) in sites.iter().enumerate() {
            if is_joined[number] || site.is_of_the_engine {
                continue;
            }
            is_joined[number] = true;
            for &(argument, _) in &site.args {
                if argument == u32::MAX || leaks[argument as usize] {
                    continue;
                }
                leaks[argument as usize] = true;
                let carried: SmallVec<[FuncId; 1]> = reached.remove(&argument).unwrap_or_default();
                pending.extend(carried.into_iter().map(|function| (function, argument)));
            }
        }
        if pending.is_empty() {
            break;
        }
    }
    let mut gone: Vec<FuncId> = escaped.into_iter().collect();
    gone.sort_unstable();
    for function in gone {
        let called = &program.funcs[function.idx()];
        if !called.has(func_flags::ASYNC | func_flags::GENERATOR) {
            more.edges.extend(kinds_kept_unboxed(program, called.result).map(|kind| (nodes.result(function.idx()), nodes.yielded + kind, UNDEFINED)));
        }
    }
    more
}

/// An operation that may throw ends its block there. So nothing that may throw is put into such a function afterwards, and no test counts in it.
fn has_handlers(func: &Func) -> bool {
    func.blocks.iter().any(|block| matches!(block.term, Some(Term::Invoke { .. } | Term::Throw { unwind: Some(_), .. })))
}

/// What is shown of which value if the condition comes out truthy (`sense`) or falsy.
fn add_shown_by(func: &Func, strs: &Strs, condition: V, sense: bool, depth: u32, shown: &mut Vec<(u32, u8)>) {
    if depth == 0 {
        return;
    }
    let key = |v: V| before_casts(func, v).idx() as u32;
    match func.op(condition) {
        Some(&Op::Truthy(v)) => {
            if sense {
                shown.push((key(v), NIL));
            }
            add_shown_by(func, strs, v, sense, depth - 1, shown);
        }
        Some(&Op::Not(v)) => add_shown_by(func, strs, v, !sense, depth - 1, shown),
        Some(&Op::Coerce { value, why, .. }) if why != Why::Coerce => add_shown_by(func, strs, value, sense, depth - 1, shown),
        Some(&Op::IsNullish(v)) => {
            if !sense {
                shown.push((key(v), NIL));
            }
        }
        Some(&Op::StrictEq { a, b }) => {
            for (it, other) in [(a, b), (b, a)] {
                match func.op(before_casts(func, other)) {
                    Some(Op::Undefined) if !sense => shown.push((key(it), UNDEFINED)),
                    Some(Op::Null) if !sense => shown.push((key(it), NULL)),
                    Some(Op::Bool(_) | Op::Int(_) | Op::Double(_) | Op::BigInt(_)) if sense => shown.push((key(it), NIL)),
                    Some(&Op::Str(text)) => {
                        if sense {
                            shown.push((key(it), NIL));
                        }
                        if let Some(&Op::TypeOf(of)) = func.op(before_casts(func, it)) {
                            match strs.get(text) {
                                b"undefined" if !sense => shown.push((key(of), UNDEFINED)),
                                b"undefined" => {}
                                b"object" if sense => shown.push((key(of), UNDEFINED)),
                                _ if sense => shown.push((key(of), NIL)),
                                _ => {}
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
        Some(&Op::LooseEq { a, b }) => {
            for (it, other) in [(a, b), (b, a)] {
                if !sense && matches!(func.op(before_casts(func, other)), Some(Op::Undefined | Op::Null)) {
                    shown.push((key(it), NIL));
                }
            }
        }
        // `undefined` compares as NaN does. `null` is 0.
        Some(&Op::Relational { a, b, .. }) => {
            if sense {
                shown.push((key(a), UNDEFINED));
                shown.push((key(b), UNDEFINED));
            }
        }
        _ => {
            if sense {
                shown.push((key(condition), NIL));
            }
        }
    }
}

/// The fields by the name in the layouts that the type names.
pub(super) fn fields_named(program: &Program, ty: TyId, name: StrId) -> SmallVec<[(LayoutId, u32); 2]> {
    if ty.is_none() {
        return SmallVec::new();
    }
    let layouts = program.tys.get(ty).parts.iter().filter_map(|part| if let Part::Class(layout) = part { layout.is_some().then_some(*layout) } else { None });
    layouts.filter_map(|layout| Some((layout, program.layouts[layout.idx()].field(name)?))).collect()
}

fn property_deleted_by(func: &Func, op: &Op) -> Option<(V, StrId)> {
    match *op {
        Op::PropDelete { obj, name } => Some((obj, name)),
        Op::ElemDelete { obj, key } => match func.op(before_casts(func, key)) {
            Some(&Op::Str(name)) => Some((obj, name)),
            _ => None,
        },
        _ => None,
    }
}

fn fields_of_any_object(program: &Program, ty: TyId, name: StrId) -> Vec<(LayoutId, u32)> {
    let takes_strangers = |part: &Part| matches!(part, Part::Class(view) if view.is_some() && program.layouts[view.idx()].admits_foreign);
    if ty.is_none() || ty == program.tys.anything || !program.tys.get(ty).any_object && !program.tys.get(ty).parts.iter().any(takes_strangers) {
        return Vec::new();
    }
    let of_objects = program.layouts.iter().enumerate().filter(|of| of.1.kind != crate::ir::LayoutKind::Environment);
    of_objects.filter_map(|(index, layout)| Some((LayoutId::new(index), layout.field(name)?))).collect()
}

#[derive(Default)]
pub(super) struct Deleted {
    pub(super) places: usize,
    pub(super) places_by_name: usize,
    pub(super) turned_by_name: usize,
    pub(super) never_seen_absent: usize,
    pub(super) turned: Vec<(LayoutId, StrId)>,
}

pub(super) fn make_room_for_deletions(program: &mut Program, in_parallel: InParallel<'_>) -> Deleted {
    let mut deleted = Deleted::default();
    let (mut through, mut by_name): (Vec<(LayoutId, StrId)>, Vec<(LayoutId, StrId)>) = (Vec::new(), Vec::new());
    {
        let program: &Program = program;
        type Fields = Vec<(LayoutId, StrId)>;
        let mut runs: Vec<(&[Func], Deleted, Fields, Fields)> = program.funcs.chunks(FUNCTIONS_OF_A_TASK).map(|funcs| (funcs, Deleted::default(), Vec::new(), Vec::new())).collect();
        for_each_mut(&mut runs, in_parallel, &|(funcs, deleted, through, by_name)| {
            for func in funcs.iter() {
                for value in &func.values {
                    let Def::Op(op) = &value.def else { continue };
                    let Some((obj, name)) = property_deleted_by(func, op) else { continue };
                    let (of_views, of_any_object) = (fields_named(program, func.ty(obj), name), fields_of_any_object(program, func.ty(obj), name));
                    deleted.places += usize::from(!of_views.is_empty());
                    deleted.places_by_name += usize::from(!of_any_object.is_empty());
                    through.extend(of_views.into_iter().map(|(view, _)| (view, name)));
                    by_name.extend(of_any_object.into_iter().map(|(layout, _)| (layout, name)));
                }
            }
        });
        for (_, of_run, mut through_in_run, mut by_name_in_run) in runs {
            deleted.places += of_run.places;
            deleted.places_by_name += of_run.places_by_name;
            through.append(&mut through_in_run);
            by_name.append(&mut by_name_in_run);
        }
    }
    let through_views = through.len();
    let mut seen: FxHashSet<(LayoutId, StrId)> = FxHashSet::default();
    for (number, (view, name)) in through.into_iter().chain(by_name).enumerate() {
        let mut pending = vec![view];
        while let Some(layout) = pending.pop() {
            if !seen.insert((layout, name)) {
                continue;
            }
            let own = &mut program.layouts[layout.idx()];
            pending.extend(own.members.iter().chain(&own.specializations).copied());
            let Some(field) = own.field(name) else { continue };
            let flags = &mut own.fields[field as usize].flags;
            if *flags & (crate::ir::field_flags::OPTIONAL | crate::ir::field_flags::METHOD) == 0 {
                deleted.never_seen_absent += usize::from(*flags & crate::ir::field_flags::NEVER_SEEN_ABSENT != 0);
                *flags &= !crate::ir::field_flags::NEVER_SEEN_ABSENT;
                *flags |= crate::ir::field_flags::OPTIONAL;
                deleted.turned.push((layout, name));
                deleted.turned_by_name += usize::from(number >= through_views);
            }
        }
    }
    deleted
}

pub(super) fn reads_that_may_find_deleted(program: &Program, deleted: &Deleted) -> usize {
    let turned: FxHashSet<(LayoutId, StrId)> = deleted.turned.iter().copied().collect();
    let may_find = |view: LayoutId, name: StrId| {
        let looked_at = &program.layouts[view.idx()];
        looked_at.members.iter().chain(&looked_at.specializations).chain([&view]).any(|&member| turned.contains(&(member, name)))
    };
    let is_such = |func: &Func, def: &Def| matches!(*def, Def::Op(Op::PropGet { obj, name }) if fields_named(program, func.ty(obj), name).into_iter().any(|(view, _)| may_find(view, name)));
    if turned.is_empty() { 0 } else { program.funcs.iter().map(|func| func.values.iter().filter(|value| is_such(func, &value.def)).count()).sum() }
}

/// The function that an object of the layout finds by the name and calls, if that is a fact.
fn function_found_in(program: &Program, layout: LayoutId, name: StrId) -> Option<FuncId> {
    let is_fact = |flags: u8| flags & (only_function_flags::IS_FACT | only_function_flags::OR_NIL) != 0;
    let own: &Layout = &program.layouts[layout.idx()];
    if own.class_flags & class_flags::MAY_HAVE_OTHER_PROTOTYPE != 0 {
        return None;
    }
    let mut at = layout;
    while at.is_some() {
        let class = &program.layouts[at.idx()];
        if let Some(method) = class.methods.iter().find(|method| method.name == name && method.flags & method_flags::STATIC == 0) {
            return (method.kind == MethodKind::Method && method.flags & method_flags::MAY_BE_REPLACED == 0).then_some(method.func);
        }
        at = class.base;
    }
    let field = &own.fields[own.field(name)? as usize];
    (field.only_function.is_some() && is_fact(field.only_function_flags)).then_some(field.only_function)
}

/// The functions one of which the operation calls, if all are known, and its arguments.
pub(super) fn functions_called<'a>(program: &Program, func: &'a Func, v: V) -> Option<(SmallVec<[FuncId; 2]>, &'a [V])> {
    let is_fact = |flags: u8| flags & (only_function_flags::IS_FACT | only_function_flags::OR_NIL) != 0;
    // By the name, in whatever object may be looked at as the type.
    let found_by = |obj: V, name: StrId| -> Option<SmallVec<[FuncId; 2]>> {
        let view = program.tys.get(func.ty(obj)).only_layout()?;
        let looked_at = &program.layouts[view.idx()];
        if looked_at.admits_foreign {
            return None;
        }
        let mut found: SmallVec<[FuncId; 2]> = SmallVec::new();
        for &member in looked_at.members.iter().chain(looked_at.members.is_empty().then_some(&view)) {
            let function = function_found_in(program, member, name)?;
            if !found.contains(&function) {
                found.push(function);
            }
        }
        Some(found)
    };
    match func.op(v)? {
        Op::Call { callee, args, .. } => {
            let found = match *func.op(before_casts(func, *callee))? {
                Op::FuncRef(function) | Op::Closure { func: function, .. } | Op::ClosureOnce { func: function, .. } => SmallVec::from_iter([function]),
                Op::FieldGet { layout, field, .. } => {
                    let field = &program.layouts[layout.idx()].fields[field as usize];
                    (field.only_function.is_some() && is_fact(field.only_function_flags)).then(|| SmallVec::from_iter([field.only_function]))?
                }
                Op::GlobalGet(global) => {
                    let global = &program.globals[global.idx()];
                    (global.only_function.is_some() && is_fact(global.only_function_flags)).then(|| SmallVec::from_iter([global.only_function]))?
                }
                Op::PropGet { obj, name } => found_by(obj, name)?,
                _ => return None,
            };
            Some((found, &args[..]))
        }
        Op::CallMethod { obj, name, args } => Some((found_by(*obj, *name)?, &args[..])),
        _ => None,
    }
}

/// Whether `o.name`, for an `o` of the type, is a field of whatever object that is: no accessor is found, no code runs.
fn is_field_for_sure(program: &Program, ty: TyId, name: StrId) -> bool {
    let Some(view) = (if ty.is_some() { program.tys.get(ty).only_layout() } else { None }) else { return false };
    let looked_at = &program.layouts[view.idx()];
    !looked_at.admits_foreign && looked_at.members.iter().chain(looked_at.members.is_empty().then_some(&view)).all(|member| program.layouts[member.idx()].field(name).is_some())
}

/// What the function does to the places `o.name`, by block, and the name of each place.
fn place_events(program: &Program, func: &Func) -> (Vec<Vec<PlaceEvent>>, Vec<u32>) {
    let key = |v: V| before_casts(func, v).idx() as u32;
    let is_primitive = |v: V| func.ty(v).is_some() && func.ty(v) != program.tys.anything && !program.tys.get(func.ty(v)).has_objects();
    // A parameter of a block that is handed one value on every way is that value: `node`, where two ways meet.
    let mut stands_for: FxHashMap<V, V> = FxHashMap::default();
    loop {
        let object = |mut v: V| {
            loop {
                v = before_casts(func, v);
                match stands_for.get(&v) {
                    Some(&same) => v = same,
                    None => return v,
                }
            }
        };
        // `NONE`: more than one.
        let mut handed: FxHashMap<V, V> = FxHashMap::default();
        for block in &func.blocks {
            for target in targets_of(block.term.as_ref()) {
                for (&argument, &parameter) in target.args.iter().zip(&func.blocks[target.block.idx()].params) {
                    let argument = object(argument);
                    if argument != parameter && !stands_for.contains_key(&parameter) {
                        let known = handed.entry(parameter).or_insert(argument);
                        if *known != argument {
                            *known = V::NONE;
                        }
                    }
                }
            }
        }
        handed.retain(|_, same| same.is_some());
        if handed.is_empty() {
            break;
        }
        stands_for.extend(handed);
    }
    let object = |mut v: V| {
        loop {
            v = before_casts(func, v);
            match stands_for.get(&v) {
                Some(&same) => v = same,
                None => return v.idx() as u32,
            }
        }
    };
    let mut places: FxHashMap<(u32, StrId), u32> = FxHashMap::default();
    let mut names: Vec<u32> = Vec::new();
    let mut place = |obj: V, name: StrId| {
        *places.entry((object(obj), name)).or_insert_with(|| {
            names.push(name.idx() as u32);
            names.len() as u32 - 1
        })
    };
    let events = func
        .blocks
        .iter()
        .map(|block| {
            let mut events = Vec::new();
            for &v in &block.ops {
                match func.op(v) {
                    Some(&Op::PropGet { obj, name }) if is_field_for_sure(program, func.ty(obj), name) => events.push(PlaceEvent::Read { place: place(obj, name), value: key(v) }),
                    Some(&Op::PropSet { obj, name, value }) if is_field_for_sure(program, func.ty(obj), name) => {
                        let may_be_nil = func.ty(value).is_none() || func.ty(value) == program.tys.anything || program.tys.get(func.ty(value)).prims & prim::NULLISH != 0;
                        events.push(PlaceEvent::Store { place: place(obj, name), value: key(value), may_be_nil });
                    }
                    Some(
                        Op::Undefined
                        | Op::Null
                        | Op::Bool(_)
                        | Op::Int(_)
                        | Op::Double(_)
                        | Op::Str(_)
                        | Op::BigInt(_)
                        | Op::FuncRef(_)
                        | Op::GlobalGet(_)
                        | Op::GlobalSet(..)
                        | Op::FieldGet { .. }
                        | Op::FieldSet { .. }
                        | Op::StrictEq { .. }
                        | Op::Not(_)
                        | Op::Truthy(_)
                        | Op::TypeOf(_)
                        | Op::IsNullish(_)
                        | Op::IsInstance { .. },
                    ) => {}
                    Some(&Op::Coerce { why, .. }) if why != Why::Coerce => {}
                    Some(&Op::Binary { a, b, .. } | &Op::Relational { a, b, .. }) if is_primitive(a) && is_primitive(b) => {}
                    Some(&Op::Unary { a, .. }) if is_primitive(a) => {}
                    _ => events.push(PlaceEvent::Anything),
                }
            }
            events
        })
        .collect();
    (events, names)
}

struct Report<'a> {
    program: &'a Program,
    nodes: &'a Nodes,
    /// The name of the operation.
    initialize: StrId,
    edges: Vec<(u32, u32)>,
    origins: Vec<(u32, u8)>,
    /// The fields that are connected with those that share their place.
    connected: FxHashSet<(LayoutId, u32)>,
    as_values: FunctionsAsValues,
}

impl Report<'_> {
    /// The node of the field. An object that is looked at through a view is one of its members, and what a cast turns it into has what it had.
    fn field(&mut self, layout: LayoutId, field: u32) -> u32 {
        self.connected.insert((layout, field));
        self.nodes.field(layout, field)
    }

    fn connect(&mut self, layout: LayoutId, field: u32) {
        let node = self.nodes.field(layout, field);
        {
            let own = &self.program.layouts[layout.idx()];
            let name = own.fields[field as usize].name;
            for &other in own.members.iter().chain(&own.specializations).filter(|&&other| other != layout) {
                if let Some(same) = self.program.layouts[other.idx()].field(name) {
                    let there = self.nodes.field(other, same);
                    self.edges.push((node, there));
                    self.edges.push((there, node));
                    let (of_view, of_member) = (own.fields[field as usize].declared, self.program.layouts[other.idx()].fields[same as usize].declared);
                    if of_view.is_some() && of_member.is_some() && of_view != self.program.tys.anything && of_member != self.program.tys.anything {
                        let missing = self.program.tys.get(of_member).prims & prim::NULLISH & !self.program.tys.get(of_view).prims;
                        if missing != 0 {
                            self.origins.push((node, missing as u8));
                        }
                    }
                }
            }
        }
    }

    /// `list.map(n => ..)`: the function is called with an element. `elements`: `parameters_handed_elements`.
    fn hand_elements_to_functions(&mut self, func: &Func, handed: &[V], elements: &[usize], is_as_today: bool) {
        for &argument in handed {
            let (Some(&Op::FuncRef(function)) | Some(&Op::Closure { func: function, .. }) | Some(&Op::ClosureOnce { func: function, .. })) = func.op(before_casts(func, argument)) else { continue };
            let called = &self.program.funcs[function.idx()];
            let Some(entered) = called.blocks.first() else { continue };
            let ahead = entered.params.len().saturating_sub(called.params.len());
            for &parameter in elements.iter().filter_map(|&number| entered.params.get(ahead + number)) {
                if is_as_today {
                    self.origins.push((self.nodes.value(function.idx(), parameter), UNDEFINED));
                    self.as_values.left_out.push(self.nodes.value(function.idx(), parameter));
                } else {
                    self.as_values.handed.push(self.nodes.value(function.idx(), parameter));
                }
            }
        }
    }

    fn function(&mut self, index: usize) -> NilFlowsInFunction {
        let (program, nodes) = (self.program, self.nodes);
        let func = &program.funcs[index];
        let mut flows = NilFlowsInFunction { blocks: func.blocks.len() as u32, ..NilFlowsInFunction::default() };
        let counts_tests = !has_handlers(func);
        let key = |v: V| before_casts(func, v).idx() as u32;
        let node = |v: V| nodes.value(index, v);
        let parameter_of = |callee: FuncId, number: usize| -> Option<u32> {
            let entered = program.funcs[callee.idx()].blocks.first()?;
            Some(nodes.value(callee.idx(), *entered.params.get(number)?))
        };
        let returns_what_it_yields = |callee: FuncId| !program.funcs[callee.idx()].has(func_flags::ASYNC | func_flags::GENERATOR);
        // What is shown on which way comes first: what a read of `o.name` finds goes by it.
        for (number, block) in func.blocks.iter().enumerate() {
            let condition = match block.term {
                Some(Term::Branch { cond, .. }) if counts_tests => cond,
                _ => V::NONE,
            };
            for (which, target) in targets_of(block.term.as_ref()).into_iter().enumerate() {
                let mut shown = Vec::new();
                if condition.is_some() {
                    add_shown_by(func, &program.strs, condition, which == 0, 8, &mut shown);
                }
                flows.jumps.push(Jump { from: number as u32, to: target.block.idx() as u32, shown });
            }
        }
        let stored_values_read = if counts_tests {
            let (events, names) = place_events(program, func);
            stored_values_read(&flows, &events, &names)
        } else {
            FxHashMap::default()
        };
        let mut local_arrays: FxHashSet<V> = func.blocks.iter().flat_map(|block| &block.ops).copied().filter(|&v| matches!(func.op(v), Some(Op::NewArray(_)))).collect();
        if !local_arrays.is_empty() {
            let mut is_used_otherwise = |operand: V| {
                if operand.is_some() {
                    local_arrays.remove(&before_casts(func, operand));
                }
            };
            for block in &func.blocks {
                for &v in &block.ops {
                    match func.op(v) {
                        Some(Op::Coerce { .. } | Op::IterOpen(_)) | None => {}
                        Some(&Op::ElemGet { key, .. } | &Op::ElemHas { key, .. }) => is_used_otherwise(key),
                        Some(&Op::PropGet { name, .. }) if program.strs.get(name) == b"length" => {}
                        Some(op) => op.for_each_operand(&mut is_used_otherwise),
                    }
                }
                if let Some(term) = &block.term {
                    term.for_each_operand(&mut is_used_otherwise);
                }
            }
        }
        let mut jump = 0;
        for (number, block) in func.blocks.iter().enumerate() {
            let at = number as u32;
            for &v in &block.ops {
                let hand_on = |flows: &mut NilFlowsInFunction, value: V, to: u32| {
                    if value.is_some() {
                        flows.uses.push(Use { value: key(value), from: node(value), to, block: at, jump: NO_JUMP });
                    }
                };
                let seen = |value: V| value.is_some().then(|| node(value));
                let typed = |value: V| if value.is_some() { (node(value), func.ty(value)) } else { (u32::MAX, TyId::NONE) };
                match func.op(v) {
                    // There need be no element, and an element that is there may be `undefined`: nothing is known of what a container holds.
                    Some(&Op::ElemGet { obj: held, .. } | &Op::IterGet { iter: held, .. }) => {
                        let array = before_casts(func, if let Some(&Op::IterOpen(opened)) = func.op(held) { opened } else { held });
                        if let Some(Op::NewArray(elements)) = func.op(array).filter(|_| local_arrays.contains(&array)) {
                            self.as_values.moves.extend(elements.iter().filter_map(|&element| seen(element)).map(|element| (element, node(v))));
                        }
                        self.as_values.left_out.push(node(v));
                        flows.origins.push(Origin { node: node(v), nil: UNDEFINED, block: at, unless: Vec::new() });
                    }
                    Some(Op::NewArray(_)) if local_arrays.contains(&v) => {}
                    Some(Op::NewArray(elements)) => self.as_values.leaks.extend(elements.iter().filter_map(|&element| seen(element))),
                    Some(&Op::ElemSet { value, .. }) => self.as_values.leaks.extend(seen(value)),
                    Some(Op::IterOpen(_) | Op::IterClose(_) | Op::IterCloseForThrow(_)) => {}
                    Some(&Op::Coerce { value, to, why })
                        if why == Why::Forced
                            || matches!(why, Why::Flow | Why::Claim | Why::Store | Why::Cast | Why::CastFresh) && !func.has(func_flags::IS_HIDDEN_IN_STACK_TRACES) && has_only_empty_views(&program.tys, &program.layouts, to) =>
                    {
                        hand_on(&mut flows, value, node(v));
                        flows.origins.push(Origin { node: node(v), nil: STRANGER, block: at, unless: Vec::new() });
                    }
                    Some(&Op::Coerce { value, to, why }) => {
                        if matches!(why, Why::NonNull(_) | Why::Coerce) {
                            self.as_values.moves.push((node(value), node(v)));
                            continue;
                        }
                        // `if (!node.id) { node.id = next } return node.id`: what the function has stored there itself.
                        if let Some(stored) = stored_values_read.get(&key(value)) {
                            for &stored in stored {
                                flows.uses.push(Use { value: stored, from: node(V::new(stored as usize)), to: node(v), block: at, jump: NO_JUMP });
                            }
                            continue;
                        }
                        hand_on(&mut flows, value, node(v));
                        // All that the type takes away is what need not be there.
                        if matches!(why, Why::Store | Why::Cast | Why::CastFresh) && func.ty(value) != program.tys.anything && func.ty(value).is_some() && to.is_some() {
                            let (have, want) = (program.tys.get(func.ty(value)), program.tys.get(to));
                            let taken = have.prims & prim::NULLISH & !want.prims;
                            if taken != 0 && (Declared { prims: have.prims & !taken, ..have.clone() }).is_described_within(want) {
                                let unless = if counts_tests { vec![(key(value), taken as u8)] } else { Vec::new() };
                                flows.origins.push(Origin { node: node(v), nil: taken as u8, block: at, unless });
                            }
                        }
                    }
                    // A promise is a container too, and whoever resumes a generator sends what he likes, or nothing.
                    Some(&Op::Await(value)) => {
                        hand_on(&mut flows, value, node(v));
                        self.as_values.left_out.push(node(v));
                        flows.origins.push(Origin { node: node(v), nil: UNDEFINED, block: at, unless: Vec::new() });
                    }
                    Some(&Op::Yield(value)) => {
                        self.as_values.leaks.extend(seen(value));
                        self.as_values.left_out.push(node(v));
                        flows.origins.push(Origin { node: node(v), nil: UNDEFINED, block: at, unless: Vec::new() });
                    }
                    Some(&Op::GlobalGet(global)) => {
                        self.as_values.births.extend(Some(program.globals[global.idx()].only_function).filter(|function| function.is_some()).map(|function| (node(v), function)));
                        self.edges.push((nodes.globals + global.idx() as u32, node(v)));
                    }
                    Some(&Op::GlobalSet(global, value)) => hand_on(&mut flows, value, nodes.globals + global.idx() as u32),
                    Some(&Op::FieldGet { layout, field, .. }) => {
                        self.as_values.births.extend(Some(program.layouts[layout.idx()].fields[field as usize].only_function).filter(|function| function.is_some()).map(|function| (node(v), function)));
                        let from = self.field(layout, field);
                        self.edges.push((from, node(v)));
                    }
                    Some(&Op::FieldSet { layout, field, value, .. }) => {
                        let to = self.field(layout, field);
                        hand_on(&mut flows, value, to);
                    }
                    Some(&Op::NewWith { layout, name, value }) => {
                        if let Some(field) = program.layouts[layout.idx()].field(name) {
                            let to = self.field(layout, field);
                            hand_on(&mut flows, value, to);
                        } else {
                            self.as_values.leaks.extend(seen(value));
                        }
                    }
                    Some(&Op::PropGet { obj, name }) => {
                        match program.strs.get(name) {
                            b"call" | b"apply" | b"bind" => self.as_values.leaks.extend(seen(obj)),
                            _ => {}
                        }
                        if let Some(view) = if func.ty(obj).is_some() { program.tys.get(func.ty(obj)).only_layout() } else { None } {
                            let looked_at = &program.layouts[view.idx()];
                            for &member in looked_at.members.iter().chain(looked_at.members.is_empty().then_some(&view)) {
                                self.as_values.births.extend(function_found_in(program, member, name).map(|function| (node(v), function)));
                            }
                        }
                        if let Some(&Op::FuncRef(class)) | Some(&Op::Closure { func: class, .. }) = func.op(before_casts(func, obj)) {
                            let statics = program.layouts.iter().filter(|layout| layout.constructor == class).flat_map(|layout| &layout.methods);
                            self.as_values.births.extend(statics.filter(|method| method.name == name && method.flags & method_flags::STATIC != 0).map(|method| (node(v), method.func)));
                        }
                        let fields = fields_named(program, func.ty(obj), name);
                        // `table.key`, found by an index signature; a property of what is not typed: no layout vouches for it, and there need be none.
                        if fields.is_empty() && func.ty(obj).is_some() && program.tys.get(func.ty(obj)).any_object {
                            self.as_values.left_out.push(node(v));
                            flows.origins.push(Origin { node: node(v), nil: UNDEFINED, block: at, unless: Vec::new() });
                        }
                        for (layout, field) in fields {
                            let from = self.field(layout, field);
                            self.edges.push((from, node(v)));
                        }
                    }
                    Some(&Op::PropSet { obj, name, value }) => {
                        if fields_named(program, func.ty(obj), name).is_empty() {
                            self.as_values.leaks.extend(seen(value));
                        }
                        for (layout, field) in fields_named(program, func.ty(obj), name) {
                            let to = self.field(layout, field);
                            hand_on(&mut flows, value, to);
                        }
                    }
                    Some(op @ (Op::PropDelete { .. } | Op::ElemDelete { .. })) => {
                        let Some((obj, name)) = property_deleted_by(func, op) else { continue };
                        for (layout, field) in fields_named(program, func.ty(obj), name).into_iter().chain(fields_of_any_object(program, func.ty(obj), name)) {
                            let emptied = self.field(layout, field);
                            self.origins.push((emptied, UNDEFINED));
                        }
                    }
                    Some(&Op::FuncRef(function)) => self.as_values.births.push((node(v), function)),
                    Some(Op::Closure { func: made, captures } | Op::ClosureOnce { func: made, captures, .. }) => {
                        self.as_values.births.push((node(v), *made));
                        for (number, &capture) in captures.iter().enumerate() {
                            if let Some(to) = parameter_of(*made, number) {
                                hand_on(&mut flows, capture, to);
                            } else {
                                self.as_values.leaks.extend(seen(capture));
                            }
                        }
                    }
                    Some(Op::CallDirect { func: callee, args }) => {
                        for (number, &argument) in args.iter().enumerate() {
                            if let Some(to) = parameter_of(*callee, number) {
                                hand_on(&mut flows, argument, to);
                            } else {
                                self.as_values.leaks.extend(seen(argument));
                            }
                        }
                        if returns_what_it_yields(*callee) {
                            self.edges.push((nodes.result(callee.idx()), node(v)));
                        }
                    }
                    // `Initialize this, "a", x, "b", 0, ..`: the first stores of a constructor function.
                    Some(Op::Operation { name, args }) if *name == self.initialize => {
                        for store in args[1..].chunks_exact(2) {
                            let Some(&Op::Str(name)) = func.op(store[0]) else {
                                self.as_values.leaks.extend(seen(store[1]));
                                continue;
                            };
                            if fields_named(program, func.ty(args[0]), name).is_empty() {
                                self.as_values.leaks.extend(seen(store[1]));
                            }
                            for (layout, field) in fields_named(program, func.ty(args[0]), name) {
                                let to = self.field(layout, field);
                                hand_on(&mut flows, store[1], to);
                            }
                        }
                    }
                    Some(Op::Call { .. } | Op::CallMethod { .. }) => {
                        let Some((callees, args)) = functions_called(program, func, v) else {
                            let mut is_of_the_engine = false;
                            let by_name = match func.op(v) {
                                Some(&Op::CallMethod { obj, name, ref args }) => Some((obj, name, &args[..])),
                                Some(&Op::Call { callee, this, ref args }) => match func.op(before_casts(func, callee)) {
                                    Some(&Op::PropGet { obj, name }) if this.is_some() && before_casts(func, obj) == before_casts(func, this) => Some((obj, name, &args[..])),
                                    _ => None,
                                },
                                _ => None,
                            };
                            if let Some((obj, name, handed)) = by_name {
                                let receiver = func.ty(obj);
                                let is_array = receiver.is_some() && !program.tys.get(receiver).any_object && program.tys.get(receiver).parts.iter().all(|part| matches!(part, Part::Array(_)));
                                self.hand_elements_to_functions(func, handed, parameters_handed_elements(program.strs.get(name), is_array), matches!(func.op(v), Some(Op::CallMethod { .. })));
                                is_of_the_engine = !parameters_handed_elements(program.strs.get(name), is_array).is_empty() && !may_reach_the_program(program, func, v);
                            }
                            let (callees, handed): (SmallVec<[u32; 1]>, &[V]) = match func.op(v) {
                                Some(&Op::Call { callee, this, ref args }) => {
                                    self.as_values.leaks.extend(seen(this));
                                    (SmallVec::from_iter([node(callee)]), &args[..])
                                }
                                Some(&Op::CallMethod { obj, name, ref args }) => {
                                    if matches!(program.strs.get(name), b"call" | b"apply" | b"bind") {
                                        self.as_values.leaks.extend(seen(obj));
                                    }
                                    (fields_named(program, func.ty(obj), name).into_iter().map(|(layout, field)| self.field(layout, field)).collect(), &args[..])
                                }
                                _ => continue,
                            };
                            if !is_of_the_engine && !may_reach_the_program(program, func, v) {
                                self.as_values.leaks.extend(handed.iter().filter_map(|&argument| seen(argument)));
                            }
                            let is_of_the_engine = is_of_the_engine || !may_reach_the_program(program, func, v);
                            self.as_values.sites.push(Site { callees, args: handed.iter().map(|&argument| typed(argument)).collect(), result: Some(node(v)), is_of_the_engine });
                            if may_reach_the_program(program, func, v) {
                                self.edges.extend(kinds_kept_unboxed(program, func.ty(v)).map(|kind| (nodes.yielded + kind, node(v))));
                            }
                            continue;
                        };
                        for callee in callees {
                            let called = &program.funcs[callee.idx()];
                            let ahead = called.blocks.first().map_or(0, |entered| entered.params.len()).saturating_sub(called.params.len());
                            self.as_values.leaks.extend(args.iter().skip(called.params.len()).filter_map(|&argument| seen(argument)));
                            for (number, &argument) in args.iter().enumerate().take(called.params.len()) {
                                if let Some(to) = parameter_of(callee, ahead + number) {
                                    hand_on(&mut flows, argument, to);
                                } else {
                                    self.as_values.leaks.extend(seen(argument));
                                }
                            }
                            if returns_what_it_yields(callee) {
                                self.edges.push((nodes.result(callee.idx()), node(v)));
                            }
                        }
                    }
                    Some(Op::Operation { name, args }) if program.strs.get(*name) == b"ConstructWith" && args.len() >= 2 => {
                        self.as_values.sites.push(Site { callees: SmallVec::from_iter([node(args[0])]), args: args[2..].iter().map(|&argument| typed(argument)).collect(), result: None, is_of_the_engine: false });
                    }
                    Some(Op::Operation { name, args }) if program.strs.get(*name) == b"SuperConstruct" => {
                        self.as_values.leaks.extend(args.get(3).and_then(|&parent| seen(parent)));
                    }
                    Some(Op::Operation { name, .. }) if matches!(program.strs.get(*name), b"MakeClass" | b"SetFunctionName" | b"IsCallable" | b"IsConstructor") => {}
                    Some(Op::Construct { callee, args }) => {
                        self.as_values.sites.push(Site { callees: SmallVec::from_iter([node(*callee)]), args: args.iter().map(|&argument| typed(argument)).collect(), result: None, is_of_the_engine: matches!(func.op(before_casts(func, *callee)), Some(Op::FreeGet { .. })) });
                    }
                    Some(
                        Op::StrictEq { .. }
                        | Op::LooseEq { .. }
                        | Op::Not(_)
                        | Op::Truthy(_)
                        | Op::TypeOf(_)
                        | Op::IsNullish(_)
                        | Op::IsInstance { .. }
                        | Op::InstanceOf { .. }
                        | Op::Relational { .. }
                        | Op::Binary { .. }
                        | Op::Unary { .. }
                        | Op::ToStr(_)
                        | Op::ToKey(_)
                        | Op::StrConcat(_)
                        | Op::PropHas { .. }
                        | Op::ElemHas { .. }
                        | Op::IterHas { .. },
                    ) => {}
                    Some(op) => op.for_each_operand(|operand| self.as_values.leaks.extend(seen(operand))),
                    None => {}
                }
            }
            match block.term.as_ref() {
                Some(&Term::Return(value)) if value.is_some() && func.has(func_flags::ASYNC | func_flags::GENERATOR) => self.as_values.leaks.push(node(value)),
                Some(&Term::Throw { value, .. }) if value.is_some() => self.as_values.leaks.push(node(value)),
                _ => {}
            }
            if let Some(&Term::Return(value)) = block.term.as_ref()
                && value.is_some()
                && !func.has(func_flags::ASYNC | func_flags::GENERATOR)
            {
                flows.uses.push(Use { value: key(value), from: node(value), to: nodes.result(index), block: at, jump: NO_JUMP });
            }
            for target in targets_of(block.term.as_ref()) {
                for (&argument, &parameter) in target.args.iter().zip(&func.blocks[target.block.idx()].params) {
                    flows.uses.push(Use { value: key(argument), from: node(argument), to: node(parameter), block: at, jump });
                }
                jump += 1;
            }
        }
        flows
    }
}

struct Overlay<'a> {
    known: &'a DeclaredTable,
    added: Vec<Declared>,
    ids: FxHashMap<Declared, TyId>,
    anything: TyId,
}

impl Overlay<'_> {
    fn over(known: &DeclaredTable) -> Overlay<'_> {
        Overlay { known, added: Vec::new(), ids: FxHashMap::default(), anything: known.anything }
    }
    fn get(&self, id: TyId) -> &Declared {
        match id.idx().checked_sub(self.known.list.len()) {
            None => self.known.get(id),
            Some(index) => &self.added[index],
        }
    }
    fn intern(&mut self, declared: Declared) -> TyId {
        if let Some(id) = self.known.find(&declared).or_else(|| self.ids.get(&declared).copied()) {
            return id;
        }
        let id = TyId::new(self.known.list.len() + self.added.len());
        self.added.push(declared.clone());
        self.ids.insert(declared, id);
        id
    }
}

struct Slice<'a> {
    first: usize,
    funcs: &'a mut [Func],
    has_wider_values: &'a mut [bool],
    tys: Overlay<'a>,
    roomier: Roomier,
}

fn for_each_slice(tys: &mut DeclaredTable, funcs: &mut [Func], has_wider_values: &mut [bool], roomier: &mut Roomier, in_parallel: InParallel<'_>, work: &(dyn Fn(&mut Slice<'_>) + Sync)) {
    let known = tys.list.len();
    let added: Vec<Vec<Declared>> = {
        let tys: &DeclaredTable = tys;
        let mut slices: Vec<Slice<'_>> = (funcs.chunks_mut(FUNCTIONS_OF_A_TASK).zip(has_wider_values.chunks_mut(FUNCTIONS_OF_A_TASK)).enumerate())
            .map(|(number, (funcs, has_wider_values))| Slice { first: number * FUNCTIONS_OF_A_TASK, funcs, has_wider_values, tys: Overlay::over(tys), roomier: Roomier::default() })
            .collect();
        for_each_mut(&mut slices, in_parallel, &|slice| work(slice));
        for slice in &slices {
            roomier.parameters += slice.roomier.parameters;
            roomier.results += slice.roomier.results;
            roomier.narrowed += slice.roomier.narrowed;
            roomier.casts_to_empty_views.extend_from_slice(&slice.roomier.casts_to_empty_views);
        }
        slices.into_iter().map(|slice| slice.tys.added).collect()
    };
    let renamed: Vec<Vec<TyId>> = added.into_iter().map(|added| added.into_iter().map(|declared| tys.intern(declared)).collect()).collect();
    let mut slices: Vec<(&mut [Func], &Vec<TyId>)> = funcs.chunks_mut(FUNCTIONS_OF_A_TASK).zip(&renamed).filter(|slice| !slice.1.is_empty()).collect();
    for_each_mut(&mut slices, in_parallel, &|(funcs, renamed)| {
        let rename = |ty: &mut TyId| {
            if ty.is_some() && ty.idx() >= known {
                *ty = renamed[ty.idx() - known];
            }
        };
        for func in funcs.iter_mut() {
            for value in &mut func.values {
                rename(&mut value.ty);
                if let Def::Op(Op::Coerce { to, .. }) = &mut value.def {
                    rename(to);
                }
            }
            rename(&mut func.result);
            rename(&mut func.this_declared);
            func.captures.iter_mut().chain(&mut func.params).for_each(rename);
        }
    });
}

fn with_room(tys: &mut Overlay<'_>, ty: TyId, nil: u8) -> TyId {
    if nil == 0 || ty.is_none() || ty == tys.anything {
        return ty;
    }
    if nil & STRANGER != 0 {
        return tys.anything;
    }
    let described = tys.get(ty);
    if described.is_never() || nil as u32 & !described.prims == 0 {
        return ty;
    }
    let roomier = Declared { prims: described.prims | nil as u32, ..described.clone() };
    tys.intern(roomier)
}

/// What of `undefined` and `null` the one type has and the other has no room for.
fn nil_too_much(tys: &Overlay<'_>, have: TyId, want: TyId) -> u32 {
    if have.is_none() || want.is_none() || have == want || want == tys.anything {
        return 0;
    }
    tys.get(have).prims & prim::NULLISH & !tys.get(want).prims
}

/// The value as the place takes it. Where it has more room than the place, a test has shown that there is no need: it is narrowed, by an operation that is put at the end of `ops`.
fn narrowed(func: &mut Func, tys: &mut Overlay<'_>, ops: &mut Vec<V>, made: &mut FxHashMap<(V, TyId), V>, value: V, want: TyId) -> V {
    if value.is_none() {
        return value;
    }
    let have = func.ty(value);
    if have == tys.anything {
        return value;
    }
    let too_much = nil_too_much(tys, have, want);
    if too_much == 0 {
        return value;
    }
    let described = tys.get(have);
    let to = Declared { prims: described.prims & !too_much, ..described.clone() };
    let to = tys.intern(to);
    *made.entry((value, to)).or_insert_with(|| {
        let pos = func.values[value.idx()].pos;
        let held = func.add_value(Op::Coerce { value, to, why: Why::Flow }, pos, to);
        ops.push(held);
        held
    })
}

/// A condition, or what is negated: a boolean when it was translated, which may be nothing by now.
fn as_boolean(func: &mut Func, tys: &Overlay<'_>, ops: &mut Vec<V>, boolean: TyId, value: V) -> V {
    if nil_too_much(tys, func.ty(value), boolean) == 0 {
        return value;
    }
    let pos = func.values[value.idx()].pos;
    let tested = func.add_value(Op::Truthy(value), pos, boolean);
    ops.push(tested);
    tested
}

/// How many places that are kept unboxed have been given room.
#[derive(Default)]
pub(super) struct Roomier {
    pub(super) parameters: usize,
    pub(super) results: usize,
    pub(super) fields: usize,
    pub(super) variables: usize,
    pub(super) narrowed: usize,
    pub(super) casts_to_empty_views: Vec<(u32, u32, TyId)>,
}

fn is_empty_view(layout: &Layout) -> bool {
    layout.members.is_empty() && !layout.admits_foreign && !layout.is_allocated
}

fn has_only_empty_views(tys: &DeclaredTable, layouts: &[Layout], ty: TyId) -> bool {
    if ty.is_none() || ty == tys.anything {
        return false;
    }
    let described = tys.get(ty);
    !described.parts.is_empty()
        && !described.any_object
        && !described.any_function
        && described.prims & !prim::NULLISH == 0
        && described.ints.is_none()
        && described.parts.iter().all(|part| matches!(part, Part::Class(view) if view.is_some() && is_empty_view(&layouts[view.idx()])))
}

const FUNCTIONS_OF_A_TASK: usize = 256;
const NODES_OF_A_RUN: usize = 1 << 14;

pub(super) fn make_room_for_nil(program: &mut Program, in_parallel: InParallel<'_>) -> Roomier {
    let nodes = Nodes::of(program);
    let initialize = program.strs.intern(b"Initialize");
    let reaching = {
        let program: &Program = program;
        let report = || Report { program, nodes: &nodes, initialize, edges: Vec::new(), origins: Vec::new(), connected: FxHashSet::default(), as_values: FunctionsAsValues::default() };
        let mut slices: Vec<(usize, Report<'_>, NilEdges)> = (0..program.funcs.len()).step_by(FUNCTIONS_OF_A_TASK).map(|first| (first, report(), NilEdges::default())).collect();
        for_each_mut(&mut slices, in_parallel, &|(first, report, found)| {
            for index in (*first..program.funcs.len()).take(FUNCTIONS_OF_A_TASK) {
                let flows = report.function(index);
                add_nil_flows_in(&flows, found);
            }
            found.edges.extend(report.edges.drain(..).map(|(from, to)| (from, to, NIL | STRANGER)));
            found.edges.extend(report.as_values.moves.drain(..).map(|(from, to)| (from, to, 0)));
            found.origins.append(&mut report.origins);
        });
        let mut connecting = report();
        let mut connected: Vec<(LayoutId, u32)> = slices.iter().flat_map(|slice| slice.1.connected.iter().copied()).collect();
        connected.sort_unstable_by_key(|&(layout, field)| (layout.idx(), field));
        connected.dedup();
        for (layout, field) in connected {
            connecting.connect(layout, field);
        }
        let between_fields = NilEdges { edges: connecting.edges.into_iter().map(|(from, to)| (from, to, NIL | STRANGER)).collect(), origins: connecting.origins };
        let mut found: Vec<FunctionsAsValues> = slices.iter_mut().map(|slice| std::mem::take(&mut slice.1.as_values)).collect();
        let left_out: FxHashSet<u32> = found.iter_mut().flat_map(|part| std::mem::take(&mut part.left_out)).collect();
        let handed: Vec<u32> = found.iter_mut().flat_map(|part| std::mem::take(&mut part.handed)).collect();
        let from_containers = NilEdges { edges: Vec::new(), origins: slices.iter().flat_map(|slice| &slice.2.origins).filter(|origin| left_out.contains(&origin.0)).map(|origin| (origin.0, origin.1 & UNDEFINED)).collect() };
        let runs: Vec<u32> = slices.iter().map(|slice| nodes.values[slice.0]).chain((nodes.results..nodes.count).step_by(NODES_OF_A_RUN)).collect();
        let parts: Vec<&[(u32, u32, u8)]> = slices.iter().map(|slice| &slice.2).chain([&between_fields]).map(|part| &part.edges[..]).collect();
        let leaving = edges_by_node(nodes.count, &runs, &parts, |edge| Some((edge.0, edge.1)), in_parallel);
        let mut entered = enter_where_functions_get(program, &nodes, &leaving, found);
        let mut reaching = nil_reaching(&leaving, &[], slices.iter().map(|slice| &slice.2).chain([&between_fields]).flat_map(|part| part.origins.iter().copied()), |_, _| false);
        entered.origins.extend(handed.into_iter().map(|node| (node, UNDEFINED)));
        let mut leads_into_a_field = vec![false; nodes.count as usize];
        {
            let entering = edges_by_node(nodes.count, &runs, &parts, |edge| (edge.2 & UNDEFINED != 0 && edge.0 < nodes.yielded).then_some((edge.1, edge.0)), in_parallel);
            let mut pending: Vec<u32> = Vec::new();
            for (index, layout) in program.layouts.iter().enumerate().filter(|it| it.1.kind != LayoutKind::Environment) {
                for (number, field) in layout.fields.iter().enumerate() {
                    let node = nodes.field(LayoutId::new(index), number as u32);
                    if reaching[node as usize] & UNDEFINED == 0 && field.declared.is_some() && field.declared != program.tys.anything && program.tys.get(field.declared).prims & prim::UNDEFINED == 0 {
                        leads_into_a_field[node as usize] = true;
                        pending.push(node);
                    }
                }
            }
            while let Some(node) = pending.pop() {
                for &from in &entering.other[entering.at(node)] {
                    if !std::mem::replace(&mut leads_into_a_field[from as usize], true) {
                        pending.push(from);
                    }
                }
            }
        }
        entered.edges.retain(|edge| !leads_into_a_field[edge.1 as usize]);
        entered.origins.retain(|origin| !leads_into_a_field[origin.0 as usize]);
        let further = nil_reaching(&leaving, &entered.edges, entered.origins.iter().chain(&from_containers.origins).copied(), |from, to| from >= nodes.yielded && leads_into_a_field[to as usize]);
        for (all, more) in reaching.iter_mut().zip(further) {
            *all |= more;
        }
        reaching
    };
    let mut roomier = Roomier::default();
    let is_unboxed = |tys: &Overlay<'_>, ty: TyId| ty.is_some() && ty != tys.anything && !tys.get(ty).has_objects() && tys.get(ty).prims & prim::CELLS == 0 && !tys.get(ty).is_never();
    let Program { tys: table, funcs, layouts, globals, .. } = program;
    let mut over = Overlay::over(table);
    let tys = &mut over;
    for (index, layout) in layouts.iter_mut().enumerate() {
        for (number, field) in layout.fields.iter_mut().enumerate() {
            let wider = with_room(tys, field.declared, reaching[nodes.field(LayoutId::new(index), number as u32) as usize]);
            roomier.fields += usize::from(wider != field.declared && is_unboxed(tys, field.declared));
            field.declared = wider;
        }
    }
    for (index, global) in globals.iter_mut().enumerate() {
        let wider = with_room(tys, global.declared, reaching[nodes.globals as usize + index]);
        roomier.variables += usize::from(wider != global.declared && is_unboxed(tys, global.declared));
        global.declared = wider;
    }
    for declared in over.added {
        table.intern(declared);
    }
    let (layouts, globals): (&[Layout], &[crate::ir::Global]) = (layouts, globals);
    let mut has_wider_values = vec![false; funcs.len()];
    for_each_slice(table, funcs, &mut has_wider_values, &mut roomier, in_parallel, &|Slice { first, funcs, has_wider_values, tys, roomier }| {
      for (offset, func) in funcs.iter_mut().enumerate() {
        let index = *first + offset;
        // The values whose types had neither `undefined` nor `null` and have now.
        let mut is_given_room = vec![false; func.values.len()];
        for number in 0..func.values.len() {
            let nil = reaching[nodes.value(index, V::new(number)) as usize];
            if nil == 0 {
                continue;
            }
            has_wider_values[offset] = true;
            let value = &mut func.values[number];
            is_given_room[number] = value.ty.is_some() && value.ty != tys.anything && tys.get(value.ty).prims & prim::NULLISH == 0;
            let is_empty = |view: &Part| matches!(view, Part::Class(view) if view.is_some() && is_empty_view(&layouts[view.idx()]));
            if nil & STRANGER != 0 && value.ty.is_some() && value.ty != tys.anything && value.prediction == Prediction::None && !tys.get(value.ty).parts.iter().any(is_empty) {
                value.prediction = Prediction::Ty(value.ty);
            }
            value.ty = with_room(tys, value.ty, nil);
            if let Def::Op(Op::Coerce { to, why, .. }) = &mut value.def {
                if nil & STRANGER != 0 && matches!(why, Why::Flow | Why::Claim | Why::Store | Why::Cast | Why::CastFresh) && has_only_empty_views(tys.known, layouts, *to) {
                    roomier.casts_to_empty_views.push((index as u32, number as u32, *to));
                }
                *to = with_room(tys, *to, nil);
                if *why == Why::Forced || nil & STRANGER != 0 {
                    *why = Why::Upcast;
                }
            }
        }
        // `x!` where there is nothing that it could find.
        for number in 0..func.values.len() {
            if let Def::Op(Op::Coerce { value, to, why: Why::NonNull(_) }) = func.values[number].def
                && func.ty(value) != tys.anything
                && func.ty(value).is_some()
                && tys.get(func.ty(value)).prims & prim::NULLISH == 0
            {
                func.values[number].def = Def::Op(Op::Coerce { value, to, why: Why::Upcast });
            }
        }
        // `list[i]!.a`: the read stands right ahead of the assertion, and what it yields goes nowhere else. The read is given the type: it makes sure of that as it reads, one test in the place of two.
        // Only where the room is from here: `o.optional!` asserts what the type leaves open, and says so where it fails.
        let mut uses: Vec<u32> = vec![0; func.values.len()];
        for block in &func.blocks {
            let mut count = |v: V| {
                if v.is_some() {
                    uses[v.idx()] += 1;
                }
            };
            for &v in &block.ops {
                if let Some(op) = func.op(v) {
                    op.for_each_operand(&mut count);
                }
            }
            if let Some(term) = &block.term {
                term.for_each_operand(&mut count);
            }
        }
        for block in 0..func.blocks.len() {
            for at in 1..func.blocks[block].ops.len() {
                let (read, asserted) = (func.blocks[block].ops[at - 1], func.blocks[block].ops[at]);
                if let Some(&Op::Coerce { value, to, why: Why::NonNull(_) }) = func.op(asserted)
                    && value == read
                    && uses[read.idx()] == 1
                    && is_given_room[read.idx()]
                    && matches!(func.op(read), Some(Op::ElemGet { .. } | Op::PropGet { .. } | Op::Call { .. } | Op::CallMethod { .. }))
                    && func.ty(read) != tys.anything
                {
                    func.values[read.idx()].ty = to;
                    func.values[asserted.idx()].def = Def::Op(Op::Coerce { value, to, why: Why::Upcast });
                }
            }
        }
        let wider = with_room(tys, func.result, reaching[nodes.result(index) as usize]);
        roomier.results += usize::from(wider != func.result && is_unboxed(tys, func.result));
        func.result = wider;
        // What it is handed: the captures, `this`, the parameters.
        let entered: SmallVec<[V; 8]> = func.blocks.first().map_or_else(SmallVec::new, |block| block.params.iter().copied().collect());
        let ahead = func.captures.len() + usize::from(func.has(func_flags::HAS_THIS));
        for (number, &parameter) in entered.iter().enumerate() {
            let nil = reaching[nodes.value(index, parameter) as usize];
            if number < func.captures.len() {
                func.captures[number] = with_room(tys, func.captures[number], nil);
            } else if number < ahead {
                func.this_declared = with_room(tys, func.this_declared, nil);
            } else if let Some(declared) = func.params.get_mut(number - ahead) {
                let wider = with_room(tys, *declared, nil);
                roomier.parameters += usize::from(wider != *declared && is_unboxed(tys, *declared));
                *declared = wider;
            }
        }
      }
    });
    // The uses behind a test, and what has to be a boolean.
    let boolean = table.intern(Declared::prims(prim::BOOLEAN));
    let handed: Vec<SmallVec<[TyId; 8]>> = (funcs.iter())
        .map(|called| {
            let receiver = called.has(func_flags::HAS_THIS).then_some(called.this_declared);
            called.captures.iter().copied().chain(receiver).chain(called.params.iter().copied()).collect()
        })
        .collect();
    for_each_slice(table, funcs, &mut has_wider_values, &mut roomier, in_parallel, &|Slice { funcs, has_wider_values, tys, roomier, .. }| {
      for (_, func) in funcs.iter_mut().enumerate().filter(|&(offset, _)| has_wider_values[offset]) {
        let counts_tests = !has_handlers(func);
        for block in 0..func.blocks.len() {
            let before = std::mem::take(&mut func.blocks[block].ops);
            let mut ops: Vec<V> = Vec::with_capacity(before.len());
            let mut made: FxHashMap<(V, TyId), V> = FxHashMap::default();
            for v in before {
                let Some(mut op) = func.op(v).cloned() else {
                    ops.push(v);
                    continue;
                };
                // What each of the values it uses has to fit.
                let mut wanted: SmallVec<[(&mut V, TyId); 4]> = SmallVec::new();
                match &mut op {
                    Op::Not(value) => {
                        let tested = as_boolean(func, tys, &mut ops, boolean, *value);
                        if tested != *value {
                            func.values[v.idx()].def = Def::Op(Op::Not(tested));
                        }
                    }
                    _ if !counts_tests => {}
                    Op::Coerce { value, to, why: Why::Upcast } => wanted.push((value, *to)),
                    Op::FieldSet { layout, field, value, .. } => wanted.push((value, layouts[layout.idx()].fields[*field as usize].declared)),
                    Op::NewWith { layout, name, value } => {
                        if let Some(field) = layouts[layout.idx()].field(*name) {
                            wanted.push((value, layouts[layout.idx()].fields[field as usize].declared));
                        }
                    }
                    Op::GlobalSet(global, value) => wanted.push((value, globals[global.idx()].declared)),
                    Op::Operation { name, args } if *name == initialize => {
                        let receiver = func.ty(args[0]);
                        let view = if receiver.is_some() { tys.get(receiver).only_layout() } else { None };
                        let names: SmallVec<[V; 8]> = args.iter().copied().collect();
                        for (number, value) in args.iter_mut().enumerate().skip(2).step_by(2) {
                            if let (Some(view), Some(&Op::Str(name))) = (view, func.op(names[number - 1]))
                                && let Some(field) = layouts[view.idx()].field(name)
                            {
                                wanted.push((value, layouts[view.idx()].fields[field as usize].declared));
                            }
                        }
                    }
                    Op::PropSet { obj, name, value } => {
                        let receiver = func.ty(*obj);
                        if receiver.is_some()
                            && let Some(view) = tys.get(receiver).only_layout()
                            && let Some(field) = layouts[view.idx()].field(*name)
                        {
                            wanted.push((value, layouts[view.idx()].fields[field as usize].declared));
                        }
                    }
                    Op::CallDirect { func: callee, args } | Op::Closure { func: callee, captures: args } | Op::ClosureOnce { func: callee, captures: args, .. } => {
                        wanted.extend(args.iter_mut().zip(handed[callee.idx()].iter().copied()));
                    }
                    _ => {}
                }
                let mut has_changed = false;
                for (value, want) in wanted {
                    let fitting = narrowed(func, tys, &mut ops, &mut made, *value, want);
                    has_changed |= fitting != *value;
                    *value = fitting;
                }
                if has_changed {
                    func.values[v.idx()].def = Def::Op(op);
                }
                ops.push(v);
            }
            let mut term = func.blocks[block].term.take();
            if let Some(Term::Branch { cond, .. }) = &mut term {
                *cond = as_boolean(func, tys, &mut ops, boolean, *cond);
            }
            match &mut term {
                _ if !counts_tests => {}
                Some(Term::Return(value)) if !func.has(func_flags::ASYNC | func_flags::GENERATOR) => {
                    let want = func.result;
                    *value = narrowed(func, tys, &mut ops, &mut made, *value, want);
                }
                Some(Term::Jump(target)) => fit_arguments(func, tys, &mut ops, &mut made, target),
                Some(Term::Branch { then, otherwise, .. }) => {
                    roomier.narrowed += fit_arguments_on_the_way(func, tys, then);
                    roomier.narrowed += fit_arguments_on_the_way(func, tys, otherwise);
                }
                Some(Term::Switch { cases, default, .. }) => {
                    for case in cases {
                        roomier.narrowed += fit_arguments_on_the_way(func, tys, &mut case.1);
                    }
                    roomier.narrowed += fit_arguments_on_the_way(func, tys, default);
                }
                _ => {}
            }
            roomier.narrowed += made.len();
            func.blocks[block].term = term;
            func.blocks[block].ops = ops;
        }
      }
    });
    roomier
}

/// The same for one way out of several. What the test shows that decides between them holds on that way alone: `Branch typeof x === "string" ? b1(x) : b2()`. So the narrowing stands in a block of
/// its own on the way. How many values were narrowed.
fn fit_arguments_on_the_way(func: &mut Func, tys: &mut Overlay<'_>, target: &mut Target) -> usize {
    let (mut ops, mut made) = (Vec::new(), FxHashMap::default());
    let mut fitted = Target { block: target.block, args: target.args.clone() };
    fit_arguments(func, tys, &mut ops, &mut made, &mut fitted);
    if ops.is_empty() {
        return 0;
    }
    let on_the_way = crate::id::BlockId::new(func.blocks.len());
    func.blocks.push(crate::ir::Block { params: Vec::new(), ops, term: Some(Term::Jump(fitted)) });
    *target = Target::new(on_the_way);
    made.len()
}

fn fit_arguments(func: &mut Func, tys: &mut Overlay<'_>, ops: &mut Vec<V>, made: &mut FxHashMap<(V, TyId), V>, target: &mut Target) {
    let parameters: SmallVec<[V; 8]> = func.blocks[target.block.idx()].params.iter().copied().collect();
    for (argument, parameter) in target.args.iter_mut().zip(parameters) {
        let want = func.ty(parameter);
        *argument = narrowed(func, tys, ops, made, *argument, want);
    }
}
