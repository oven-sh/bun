//! A check of the linked program against the subtype sets of the soundness closure.
//!
//! The type `Class(a)` stands for every subtype of `a`. A value of that type may reach a place of type `Class(b)` untested only if every
//! subtype of `a` is a subtype of `b`. The closure sees to that for each upcast it is told of, so an upcast that nobody noted shows here.
//! The engine's verifier makes the same comparison (`Type::isWithin`), after the build.

use crate::declared::Part;
use crate::id::{LayoutId, TyId};
use crate::id::V;
use crate::ir::{Func, Op, Program, Target, Term, Why, func_flags};
use bun_sema::util::{InParallel, for_each_mut};
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

/// The values of the block that are used, untested, as of a type that is given, each with that type and what it is used as.
fn uses_in(program: &Program, func: &Func, block: usize) -> Vec<(V, TyId, &'static str)> {
    let mut uses = Vec::new();
    for &v in &func.blocks[block].ops {
        match func.op(v) {
            Some(&Op::Coerce { value, to, why: Why::Upcast }) => uses.push((value, to, "the operand of an upcast")),
            Some(&Op::FieldSet { layout, field, value, .. }) => uses.push((value, program.layouts[layout.idx()].fields[field as usize].declared, "what is stored to a field")),
            Some(&Op::GlobalSet(variable, value)) => uses.push((value, program.globals[variable.idx()].declared, "what is stored to a module variable")),
            Some(Op::CallDirect { func: callee, args }) => {
                let callee = &program.funcs[callee.idx()];
                let receiver = callee.has(func_flags::HAS_THIS).then_some((callee.this_declared, "the receiver of a direct call"));
                let wanted = (callee.captures.iter().map(|&ty| (ty, "a capture of a direct call"))).chain(receiver).chain(callee.params.iter().map(|&ty| (ty, "an argument of a direct call")));
                uses.extend(args.iter().zip(wanted).map(|(&argument, (ty, what))| (argument, ty, what)));
            }
            _ => {}
        }
    }
    // What an async function or a generator is declared to yield is not what `return` carries in its body.
    if let Some(&Term::Return(value)) = func.blocks[block].term.as_ref()
        && !func.has(func_flags::ASYNC | func_flags::GENERATOR)
    {
        uses.push((value, func.result, "the result"));
    }
    for target in targets_of(func.blocks[block].term.as_ref()) {
        uses.extend(target.args.iter().zip(&func.blocks[target.block.idx()].params).map(|(&argument, &parameter)| (argument, func.ty(parameter), "the argument for a block parameter")));
    }
    uses
}

/// A value that is used as of a type that its own is not within.
pub(crate) struct UnsoundUse {
    pub(crate) what: String,
    /// The type of the value and the type it is used as.
    types: (TyId, TyId),
    /// A layout of the type of the value, and the layouts of the type it is used as, none of which has all its subtypes.
    pub(crate) sub: LayoutId,
    pub(crate) supertypes: Vec<LayoutId>,
}

/// How many functions a task looks at.
const FUNCTIONS_OF_A_TASK: usize = 1024;

/// The first of them, at most `most`, each pair of types once, in the order of the program.
pub(crate) fn unsound_uses(program: &Program, most: usize, in_parallel: InParallel<'_>) -> Vec<UnsoundUse> {
    let subtypes: Vec<Vec<LayoutId>> = (program.layouts.iter())
        .map(|layout| {
            let mut sorted = layout.members.clone();
            sorted.sort_unstable();
            sorted
        })
        .collect();
    let mut slices: Vec<(usize, Vec<UnsoundUse>)> = (0..program.funcs.len()).step_by(FUNCTIONS_OF_A_TASK).map(|first| (first, Vec::new())).collect();
    for_each_mut(&mut slices, in_parallel, &|(first, found)| {
        let mut is_sound: FxHashMap<(TyId, TyId), bool> = FxHashMap::default();
        for (index, func) in program.funcs.iter().enumerate().skip(*first).take(FUNCTIONS_OF_A_TASK) {
            for block in reachable_blocks(func) {
                // `return;`, a receiver that is not there.
                for (argument, want, what) in uses_in(program, func, block).into_iter().filter(|used| used.0.is_some()) {
                    let have = func.ty(argument);
                    if have == want || have.is_none() || want.is_none() || is_sound.contains_key(&(have, want)) {
                        continue;
                    }
                    let lost = lost_subtype(program, &subtypes, have, want);
                    is_sound.insert((have, want), lost.is_none());
                    let Some((sub, lost)) = lost else { continue };
                    let supertypes: Vec<String> = layouts_in(program, want).map(|layout| name_of(program, layout)).collect();
                    let function = String::from_utf8_lossy(if func.name.is_none() { b"" } else { program.strs.get(func.name) });
                    let what = format!(
                        "an upcast that the soundness closure was not told of: f{index} `{function}`: {argument} of type {} is {what} of type {}, of which {} is no subtype",
                        name_of(program, sub),
                        if supertypes.is_empty() { "no object".to_owned() } else { supertypes.join(" | ") },
                        if lost == sub { "it".to_owned() } else { format!("its subtype {}", name_of(program, lost)) },
                    );
                    found.push(UnsoundUse { what, types: (have, want), sub, supertypes: layouts_in(program, want).collect() });
                    if found.len() == most {
                        return;
                    }
                }
            }
        }
    });
    let mut seen: FxHashSet<(TyId, TyId)> = FxHashSet::default();
    slices.into_iter().flat_map(|slice| slice.1).filter(|found| seen.insert(found.types)).take(most).collect()
}

/// A layout of `have` and the first of its subtypes that no layout of `want` has along with all the others.
fn lost_subtype(program: &Program, subtypes: &[Vec<LayoutId>], have: TyId, want: TyId) -> Option<(LayoutId, LayoutId)> {
    // Any object is within either.
    if program.tys.get(want).any_object || layouts_in(program, want).any(|sup| program.layouts[sup.idx()].admits_foreign) {
        return None;
    }
    for sub in layouts_in(program, have) {
        let is_subset_of = |sup: LayoutId| subtypes[sub.idx()].iter().all(|layout| subtypes[sup.idx()].binary_search(layout).is_ok());
        if layouts_in(program, want).any(|sup| sup == sub || !program.layouts[sub.idx()].admits_foreign && is_subset_of(sup)) {
            continue;
        }
        let lost = layouts_in(program, want).next().and_then(|sup| subtypes[sub.idx()].iter().find(|layout| subtypes[sup.idx()].binary_search(layout).is_err()));
        return Some((sub, lost.copied().unwrap_or(sub)));
    }
    None
}

fn layouts_in(program: &Program, ty: TyId) -> impl Iterator<Item = LayoutId> + '_ {
    // A type that is only expected of a value does not keep its layouts in the program.
    program.tys.get(ty).parts.iter().filter_map(|part| if let Part::Class(layout) = part { layout.is_some().then_some(*layout) } else { None })
}

fn name_of(program: &Program, layout: LayoutId) -> String {
    let name = program.layouts[layout.idx()].name;
    format!("{}.{}", String::from_utf8_lossy(if name.is_none() { b"" } else { program.strs.get(name) }), layout.idx())
}

fn targets_of(term: Option<&Term>) -> SmallVec<[&Target; 2]> {
    match term {
        Some(Term::Jump(target)) => SmallVec::from_iter([target]),
        Some(Term::Branch { then, otherwise, .. }) => SmallVec::from_iter([then, otherwise]),
        Some(Term::Switch { cases, default, .. }) => cases.iter().map(|case| &case.1).chain([default]).collect(),
        Some(Term::Throw { unwind, .. }) => unwind.iter().collect(),
        Some(Term::Invoke { normal, unwind }) => SmallVec::from_iter([normal, unwind]),
        Some(Term::Return(_) | Term::Unreachable) | None => SmallVec::new(),
    }
}

/// Ascending. What nothing gets to is not lowered, and its types are not looked at.
fn reachable_blocks(func: &Func) -> Vec<usize> {
    if func.blocks.is_empty() {
        return Vec::new();
    }
    let mut is_reached = vec![false; func.blocks.len()];
    is_reached[Func::ENTRY.idx()] = true;
    let mut worklist = vec![Func::ENTRY.idx()];
    while let Some(block) = worklist.pop() {
        for target in targets_of(func.blocks[block].term.as_ref()) {
            if !std::mem::replace(&mut is_reached[target.block.idx()], true) {
                worklist.push(target.block.idx());
            }
        }
    }
    (0..func.blocks.len()).filter(|&block| is_reached[block]).collect()
}
