//! One function value for a function expression that captures nothing. `{ load: () => read(), key: s => keyOf(s) }` in a function that is called a thousand times makes two thousand function
//! objects, by the language. Nobody can tell them from two if nobody tells function objects apart: compares them, uses them as keys, gives them properties, constructs with them. That is so where
//! the value is only ever stored into fields of layouts that have not escaped (`escape_closure.rs`: no untyped code holds a reference to such an object, so every access is an operation of this
//! program), and whatever is read under the names of those fields, out of whatever may be such an object, is only called and tested. Then the expression is a `FuncRef`: made once, where it is
//! first evaluated.
//!
//! An object is looked at as many types: a place may hold it if its layout is among the members of a part of the type of the place (`Layout::members`).

use crate::declared::{Declared, Part, prim};
use crate::id::{LayoutId, StrId, TyId, V};
use crate::ir::{Def, Func, LayoutKind, Op, Program, Term, Why};
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

pub(super) struct Shared {
    /// The function expressions that capture nothing and may be evaluated more than once.
    pub(super) candidates: usize,
    pub(super) shared: usize,
    /// Why the others are not, each with how many.
    pub(super) refused: Vec<(&'static str, usize)>,
}

fn declared(program: &Program, ty: TyId) -> &Declared {
    program.tys.get(if ty.is_some() { ty } else { program.tys.anything })
}

/// The allocated layouts whose objects a place of the type may hold by its parts. A place of `any object` holds none that has not escaped.
fn members_in(program: &Program, ty: &Declared) -> SmallVec<[LayoutId; 4]> {
    let mut found: SmallVec<[LayoutId; 4]> = SmallVec::new();
    for part in &ty.parts {
        if let Part::Class(view) = part {
            found.extend(program.layouts[view.idx()].members.iter().copied());
        }
    }
    found
}

/// The same. `None`: it may also hold an object of which nothing is known.
fn layouts_in(program: &Program, ty: &Declared) -> Option<SmallVec<[LayoutId; 4]>> {
    let is_open = ty.any_object || ty.parts.iter().any(|part| matches!(part, Part::Class(view) if program.layouts[view.idx()].admits_foreign));
    (!is_open).then(|| members_in(program, ty))
}

/// A cast behind which the value is the same object and is still known for what it is.
fn is_the_same_behind(program: &Program, to: TyId, why: &Why) -> bool {
    match why {
        Why::Store | Why::NonNull(_) | Why::Claim | Why::Flow | Why::Upcast => true,
        Why::Cast => {
            let to = declared(program, to);
            to.any_function && !to.any_object && to.parts.is_empty()
        }
        // `Coerce`, and whatever reason comes to be.
        _ => false,
    }
}

/// What the values come to by casts and by being passed to blocks, themselves among them. By value.
fn reached_from(program: &Program, func: &Func, roots: &[V]) -> Vec<bool> {
    let mut reached = vec![false; func.values.len()];
    for &root in roots {
        reached[root.idx()] = true;
    }
    loop {
        let mut grows = false;
        for block in &func.blocks {
            for &v in &block.ops {
                if let Some(Op::Coerce { value, to, why }) = func.op(v)
                    && reached[value.idx()]
                    && !reached[v.idx()]
                    && is_the_same_behind(program, *to, why)
                {
                    reached[v.idx()] = true;
                    grows = true;
                }
            }
            if let Some(term) = &block.term {
                term.for_each_target(|target| {
                    for (&parameter, &argument) in func.blocks[target.block.idx()].params.iter().zip(&target.args) {
                        if reached[argument.idx()] && !reached[parameter.idx()] {
                            reached[parameter.idx()] = true;
                            grows = true;
                        }
                    }
                });
            }
        }
        if !grows {
            return reached;
        }
    }
}

fn has_no_objects(program: &Program, func: &Func, v: V) -> bool {
    !declared(program, func.ty(v)).has_objects()
}

/// Whether nothing is done with what the values come to but to call it and to test it. `is_stored_well`: whether a store of it is nothing either.
fn is_only_called(program: &Program, func: &Func, roots: &[V], is_stored_well: &mut dyn FnMut(&Op) -> bool) -> bool {
    let reached = reached_from(program, func, roots);
    let is = |v: V| v.is_some() && reached[v.idx()];
    for block in &func.blocks {
        for &v in &block.ops {
            let Some(op) = func.op(v) else { continue };
            let mut takes = false;
            op.for_each_operand(|operand| takes |= is(operand));
            if !takes {
                continue;
            }
            let is_nothing = match op {
                Op::Coerce { .. } => reached[v.idx()],
                Op::Not(_) | Op::Truthy(_) | Op::IsNullish(_) | Op::TypeOf(_) => true,
                Op::Call { this, args, .. } => !is(*this) && !args.iter().any(|&arg| is(arg)),
                &Op::StrictEq { a, b } => has_no_objects(program, func, a) || has_no_objects(program, func, b),
                &Op::LooseEq { a, b } => [a, b].iter().any(|&other| {
                    let ty = declared(program, func.ty(other));
                    !ty.has_objects() && ty.prims & !prim::NULLISH == 0 && ty.ints.is_none()
                }),
                Op::FieldSet { obj, value, .. } | Op::PropSet { obj, value, .. } => !is(*obj) && is(*value) && is_stored_well(op),
                _ => false,
            };
            if !is_nothing {
                return false;
            }
        }
        if let Some(Term::Return(value) | Term::Throw { value, .. } | Term::Branch { cond: value, .. } | Term::Switch { value, .. }) = &block.term
            && is(*value)
        {
            return false;
        }
    }
    true
}

/// `has_escaped`: by layout.
pub(super) fn share_functions(program: &mut Program, has_escaped: &[bool]) -> Shared {
    let keeps = |layout: LayoutId| program.layouts[layout.idx()].kind != LayoutKind::Environment && !has_escaped[layout.idx()];
    let mut refused: FxHashMap<&'static str, usize> = FxHashMap::default();
    // The sites, each with the fields it is stored into: the layouts, and the names.
    let mut sites: Vec<(usize, V, SmallVec<[LayoutId; 4]>, SmallVec<[StrId; 2]>)> = Vec::new();
    let mut candidates = 0;
    for (index, func) in program.funcs.iter().enumerate() {
        for (value, _) in func.values.iter().enumerate().filter(|(_, value)| matches!(&value.def, Def::Op(Op::Closure { captures, .. }) if captures.is_empty())) {
            candidates += 1;
            // What names itself hands its own function object on to whoever calls it.
            let Def::Op(Op::Closure { func: made, .. }) = func.values[value].def else { continue };
            if program.funcs[made.idx()].values.iter().any(|value| matches!(value.def, Def::Op(Op::FuncRef(named) | Op::Closure { func: named, .. } | Op::ClosureOnce { func: named, .. }) if named == made)) {
                *refused.entry("it names itself").or_default() += 1;
                continue;
            }
            let (mut layouts, mut names): (SmallVec<[LayoutId; 4]>, SmallVec<[StrId; 2]>) = (SmallVec::new(), SmallVec::new());
            let mut is_kept = true;
            let is_well = is_only_called(program, func, &[V::new(value)], &mut |store| {
                let (into, name) = match *store {
                    Op::FieldSet { layout, field, .. } => (Some(SmallVec::from_slice(&[layout])), program.layouts[layout.idx()].fields[field as usize].name),
                    Op::PropSet { obj, name, .. } => (layouts_in(program, declared(program, func.ty(obj))), name),
                    _ => return false,
                };
                match into {
                    Some(into) if !into.is_empty() && into.iter().all(|&layout| keeps(layout)) => {
                        layouts.extend(into);
                        names.push(name);
                        true
                    }
                    _ => {
                        is_kept = false;
                        false
                    }
                }
            });
            if is_well {
                sites.push((index, V::new(value), layouts, names));
            } else {
                *refused.entry(if is_kept { "where it is made, more is done with it than to call it and to store it into a field" } else { "it is stored into an object that may have escaped" }).or_default() += 1;
            }
        }
    }
    let names: FxHashSet<StrId> = sites.iter().flat_map(|site| site.3.iter().copied()).collect();
    let layouts: FxHashSet<LayoutId> = sites.iter().flat_map(|site| site.2.iter().copied()).collect();
    let may_hold_one = |func: &Func, v: V| members_in(program, declared(program, func.ty(v))).iter().any(|layout| layouts.contains(layout));
    // The names under which something is read that is not only called, and the layouts whose fields are read without a name.
    let (mut observed, mut opened): (FxHashSet<StrId>, FxHashSet<LayoutId>) = (FxHashSet::default(), FxHashSet::default());
    for func in &program.funcs {
        let mut read: FxHashMap<StrId, SmallVec<[V; 4]>> = FxHashMap::default();
        for &v in func.blocks.iter().flat_map(|block| &block.ops) {
            let mut open = |obj: V| opened.extend(members_in(program, declared(program, func.ty(obj))));
            match func.op(v) {
                Some(&Op::PropGet { obj, name }) if names.contains(&name) && may_hold_one(func, obj) => read.entry(name).or_default().push(v),
                Some(&Op::FieldGet { layout, field, .. }) if layouts.contains(&layout) || program.layouts[layout.idx()].members.iter().any(|member| layouts.contains(member)) => {
                    let name = program.layouts[layout.idx()].fields[field as usize].name;
                    if names.contains(&name) {
                        read.entry(name).or_default().push(v);
                    }
                }
                Some(&Op::ElemGet { obj, key }) if may_hold_one(func, obj) => match func.op(key) {
                    Some(&Op::Str(name)) => read.entry(name).or_default().push(v),
                    _ => open(obj),
                },
                // A method of `Object.prototype`, which is handed the object.
                Some(&Op::CallMethod { obj, name, .. }) if may_hold_one(func, obj) && !names.contains(&name) => {
                    let held = members_in(program, declared(program, func.ty(obj)));
                    if !held.iter().all(|layout| program.layouts[layout.idx()].field(name).is_some() || program.layouts[layout.idx()].methods.iter().any(|method| method.name == name)) {
                        open(obj);
                    }
                }
                Some(Op::Operation { args, .. }) => {
                    for &arg in args.iter().filter(|&&arg| may_hold_one(func, arg)) {
                        open(arg);
                    }
                }
                Some(&Op::IterOpen(obj)) if may_hold_one(func, obj) => open(obj),
                _ => {}
            }
        }
        for (name, values) in read {
            if !observed.contains(&name) && !is_only_called(program, func, &values, &mut |_| false) {
                observed.insert(name);
            }
        }
    }
    let mut shared: Vec<(usize, V)> = Vec::new();
    for (func, v, into, under) in sites {
        if under.iter().any(|name| observed.contains(name)) {
            *refused.entry("what is read under the name of the field is not only called").or_default() += 1;
        } else if into.iter().any(|layout| opened.contains(layout)) {
            *refused.entry("the fields of the object are read without a name").or_default() += 1;
        } else {
            shared.push((func, v));
        }
    }
    for &(func, v) in &shared {
        let def = &mut program.funcs[func].values[v.idx()].def;
        if let Def::Op(Op::Closure { func: made, .. }) = *def {
            *def = Def::Op(Op::FuncRef(made));
        }
    }
    let mut refused: Vec<(&'static str, usize)> = refused.into_iter().collect();
    refused.sort_unstable();
    Shared { candidates, shared: shared.len(), refused }
}
