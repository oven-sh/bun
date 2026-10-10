//! What is read through a view is what one of its members holds.
//!
//! `(symbol as MappedSymbol).links`: the object may be any `Symbol`, so the front end takes what is read for anything and coerces it. Here the members of the view are known: each has in
//! the field what is stored to it, through whichever view it is looked at: `const wide: { v: number | string } = narrow; wide.v = "text"`. So, where none of them lacks it, the read is of what
//! one of those views says of the field. A coercion that finds its operand within what it tries has nothing to do.

use crate::declared::{Declared, DeclaredTable, Part, prim};
use crate::id::{LayoutId, StrId, TyId, V};
use crate::ir::{Def, Func, Layout, LayoutKind, Op, Prediction, Program, Why, class_flags, field_flags};
use rustc_hash::{FxHashMap, FxHashSet};

/// What the members of the view hold under the name. `NONE`: that says nothing, a member lacks the field, or an object that is not laid out may be looked at through the view.
/// `looked_at_as`: of each layout, the views that have it for a member. `stored_through`: the views through which the program stores to which name: a view that is only read through puts nothing
/// into a field, whatever it says of it.
fn held_by_the_members(
    tys: &mut DeclaredTable,
    layouts: &[Layout],
    looked_at_as: &[Vec<LayoutId>],
    stored_through: &FxHashSet<(LayoutId, StrId)>,
    view: LayoutId,
    name: StrId,
    is_on_object_prototype: bool,
) -> TyId {
    let looked_at = &layouts[view.idx()];
    if looked_at.admits_foreign || looked_at.field(name).is_none() {
        return TyId::NONE;
    }
    let mut held = Declared::never();
    for &member in looked_at.members.iter().chain(looked_at.members.is_empty().then_some(&view)) {
        let of_member = &layouts[member.idx()];
        // One that lacks the field may have been given a property of that name by untyped code: anything.
        let Some(own) = of_member.field(name) else { return TyId::NONE };
        // What is absent is read from the prototype chain, and there anything may be found.
        let is_always_there = of_member.fields[own as usize].flags & (field_flags::OPTIONAL | field_flags::ABSENT_AT_BIRTH | field_flags::NEVER_SEEN_ABSENT) == field_flags::NEVER_SEEN_ABSENT;
        if !is_always_there && (is_on_object_prototype || of_member.kind != LayoutKind::Record || of_member.class_flags & class_flags::MAY_HAVE_OTHER_PROTOTYPE != 0) {
            return TyId::NONE;
        }
        for &through in looked_at_as[member.idx()].iter().filter(|&&through| stored_through.contains(&(through, name))).chain([&member]) {
            let through = &layouts[through.idx()];
            let Some(field) = through.field(name) else { continue };
            let declared = through.fields[field as usize].declared;
            if declared.is_none() || declared == tys.anything {
                return TyId::NONE;
            }
            held = held.or(tys.get(declared));
        }
    }
    tys.intern(held)
}

/// How many reads were given a type, and how many coercions were left with nothing to do.
pub(super) fn type_by_the_members(program: &mut Program) -> (usize, usize) {
    let Program { tys, funcs, layouts, strs, .. } = program;
    let mut looked_at_as: Vec<Vec<LayoutId>> = vec![Vec::new(); layouts.len()];
    for (view, layout) in layouts.iter().enumerate() {
        for member in &layout.members {
            looked_at_as[member.idx()].push(LayoutId(view as u32));
        }
    }
    let initialize = strs.intern(b"Initialize");
    let mut stored_through: FxHashSet<(LayoutId, StrId)> = FxHashSet::default();
    for func in funcs.iter() {
        let mut note = |obj: V, name: StrId| {
            if func.ty(obj).is_some() {
                stored_through.extend(tys.get(func.ty(obj)).parts.iter().filter_map(|part| if let Part::Class(layout) = part { Some((*layout, name)) } else { None }));
            }
        };
        for value in &func.values {
            match &value.def {
                Def::Op(Op::PropSet { obj, name, .. }) => note(*obj, *name),
                // `Initialize this, "a", x, "b", 0, ..`: the first stores of a constructor function.
                Def::Op(Op::Operation { name, args }) if *name == initialize => {
                    for store in args[1..].chunks_exact(2) {
                        if let Some(&Op::Str(name)) = func.op(store[0]) {
                            note(args[0], name);
                        }
                    }
                }
                _ => {}
            }
        }
    }
    let mut known: FxHashMap<(LayoutId, StrId), TyId> = FxHashMap::default();
    let (mut reads, mut coercions) = (0, 0);
    for func in funcs.iter_mut() {
        for number in 0..func.values.len() {
            match func.values[number].def {
                Def::Op(Op::PropGet { obj, name }) if func.values[number].ty == tys.anything || func.values[number].prediction != Prediction::None => {
                    let receiver = func.ty(obj);
                    let Some(view) = (if receiver.is_some() { tys.get(receiver).only_layout() } else { None }) else { continue };
                    let held = match known.get(&(view, name)) {
                        Some(&held) => held,
                        None => {
                            let held = held_by_the_members(tys, layouts, &looked_at_as, &stored_through, view, name, super::NAMES_ON_OBJECT_PROTOTYPE.contains(&std::str::from_utf8(strs.get(name)).unwrap_or_default()));
                            known.insert((view, name), held);
                            held
                        }
                    };
                    // A read that is only looked at is left wider than the field, with a prediction: through such a view there is nothing to predict.
                    let own = func.values[number].ty;
                    if held.is_some() && held != own && (own == tys.anything || own.is_some() && tys.get(held).is_described_within(tys.get(own))) {
                        func.values[number].ty = held;
                        func.values[number].prediction = Prediction::None;
                        reads += 1;
                    }
                }
                // Values are numbered as they are made: the operand has its type by now.
                Def::Op(Op::Coerce { value, to, why: Why::Coerce }) => {
                    let have = func.ty(value);
                    if value.idx() < number && have.is_some() && have != tys.anything && to.is_some() && tys.get(have).is_described_within(tys.get(to)) {
                        func.values[number].def = Def::Op(Op::Coerce { value, to: have, why: Why::Upcast });
                        func.values[number].ty = have;
                        coercions += 1;
                    }
                }
                _ => {}
            }
        }
        coercions += leave_it_to_the_cast_behind(tys, func);
    }
    (reads, coercions)
}

/// `take(node as SourceFile)`, where the parameter is written `SourceFile`: a coercion, and what it yields goes nowhere but to a cast to the same objects, which makes of an object what the coercion
/// makes of it and then makes sure. So the cast takes the operand itself. Of an operand that is objects of the program and nil alone: a primitive is converted by the coercion only.
fn leave_it_to_the_cast_behind(tys: &DeclaredTable, func: &mut Func) -> usize {
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
    let mut left = 0;
    for number in 0..func.values.len() {
        let Def::Op(Op::Coerce { value: coerced, to, why: Why::Cast }) = func.values[number].def else { continue };
        let Some(&Op::Coerce { value, to: tried, why: Why::Coerce }) = func.op(coerced) else { continue };
        let have = func.ty(value);
        if uses[coerced.idx()] != 1 || have.is_none() || have == tys.anything || tried.is_none() || to.is_none() {
            continue;
        }
        let (had, tried, written) = (tys.get(have), tys.get(tried), tys.get(to));
        let is_of_the_program = |described: &Declared| {
            !described.parts.is_empty()
                && described.parts.iter().all(|part| matches!(part, Part::Class(_)))
                && !described.any_object
                && !described.any_function
                && described.prims & !prim::NULLISH == 0
                && described.ints.is_none()
        };
        if is_of_the_program(had) && is_of_the_program(tried) && tried.parts == written.parts && is_of_the_program(written) {
            func.values[number].def = Def::Op(Op::Coerce { value, to, why: Why::Cast });
            func.values[coerced.idx()].def = Def::Op(Op::Coerce { value, to: have, why: Why::Upcast });
            func.values[coerced.idx()].ty = have;
            left += 1;
        }
    }
    left
}
