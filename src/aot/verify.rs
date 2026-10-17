use crate::declared::Part;
use crate::id::V;
use crate::id::{LayoutId, TyId};
use crate::ir::{CoerceReason, Func, Op, Program, Target, Term, func_flags};
use bun_sema::util::{InParallel, for_each_mut};
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;
use std::borrow::Cow;

fn for_each_typed_use(
    program: &Program,
    func: &Func,
    block: usize,
    each: &mut impl FnMut(V, TyId, &'static str),
) {
    for &v in &func.blocks[block].ops {
        match func.op(v) {
            Some(&Op::Coerce {
                value,
                to,
                why: CoerceReason::Upcast,
            }) => each(value, to, "the operand of an upcast"),
            Some(&Op::FieldSet {
                layout,
                field,
                value,
                ..
            }) => each(
                value,
                program.layouts[layout.idx()].fields[field as usize].declared,
                "the value stored to a field",
            ),
            Some(&Op::GlobalSet(variable, value)) => each(
                value,
                program.globals[variable.idx()].declared,
                "the value stored to a module variable",
            ),
            Some(Op::CallDirect { func: callee, args }) => {
                let callee = &program.funcs[callee.idx()];
                let receiver = callee
                    .has(func_flags::HAS_THIS)
                    .then_some((callee.declared_this_type, "the receiver of a direct call"));
                let wanted = (callee
                    .captures
                    .iter()
                    .map(|&ty| (ty, "a capture of a direct call")))
                .chain(receiver)
                .chain(
                    callee
                        .params
                        .iter()
                        .map(|&ty| (ty, "an argument of a direct call")),
                );
                args.iter()
                    .zip(wanted)
                    .for_each(|(&argument, (ty, what))| each(argument, ty, what));
            }
            _ => {}
        }
    }
    if let Some(&Term::Return(value)) = func.blocks[block].term.as_ref()
        && !func.has(func_flags::ASYNC | func_flags::GENERATOR)
    {
        each(value, func.result, "the result");
    }
    if let Some(term) = &func.blocks[block].term {
        term.for_each_target(|target| {
            target
                .args
                .iter()
                .zip(&func.blocks[target.block.idx()].params)
                .for_each(|(&argument, &parameter)| {
                    each(
                        argument,
                        func.ty(parameter),
                        "the argument for a block parameter",
                    )
                })
        });
    }
}

pub(crate) struct UnsoundUse {
    pub(crate) what: String,
    types: (TyId, TyId),
}

const FUNCTIONS_PER_TASK: usize = 1024;

pub(crate) fn unsound_uses(
    program: &Program,
    maximum: usize,
    in_parallel: InParallel<'_>,
) -> Vec<UnsoundUse> {
    let subtypes: Vec<Cow<'_, [LayoutId]>> = (program.layouts.iter())
        .map(|layout| {
            if layout.members.is_sorted() {
                return Cow::Borrowed(&layout.members[..]);
            }
            let mut sorted = layout.members.clone();
            sorted.sort_unstable();
            Cow::Owned(sorted)
        })
        .collect();
    let mut slices: Vec<(usize, Vec<UnsoundUse>)> = (0..program.funcs.len())
        .step_by(FUNCTIONS_PER_TASK)
        .map(|first| (first, Vec::new()))
        .collect();
    for_each_mut(&mut slices, in_parallel, &|(first, found)| {
        let mut is_settled: FxHashMap<(TyId, TyId), bool> = FxHashMap::default();
        let (mut is_reached, mut worklist) = (Vec::new(), Vec::new());
        for (index, func) in program
            .funcs
            .iter()
            .enumerate()
            .skip(*first)
            .take(FUNCTIONS_PER_TASK)
        {
            let mut has_reachability = false;
            for block in 0..func.blocks.len() {
                for_each_typed_use(program, func, block, &mut |argument, want, what| {
                    if argument.is_none() || found.len() == maximum {
                        return;
                    }
                    let have = func.ty(argument);
                    if have == want
                        || have.is_none()
                        || want.is_none()
                        || is_settled.get(&(have, want)) == Some(&true)
                    {
                        return;
                    }
                    let Some((sub, lost)) = lost_subtype(program, &subtypes, have, want) else {
                        is_settled.insert((have, want), true);
                        return;
                    };
                    if !std::mem::replace(&mut has_reachability, true) {
                        find_reachable_blocks(func, &mut is_reached, &mut worklist);
                    }
                    is_settled.insert((have, want), is_reached[block]);
                    if !is_reached[block] {
                        return;
                    }
                    let supertypes: Vec<String> = layouts_in(program, want)
                        .map(|layout| name_of(program, layout))
                        .collect();
                    let function = bstr::BStr::new(if func.name.is_none() {
                        b"".as_slice()
                    } else {
                        program.strs.get(func.name)
                    });
                    let what = format!(
                        "an upcast that the soundness closure was not told of: f{index} `{function}`: {argument} of type {} is {what} of type {}, of which {} is no subtype",
                        name_of(program, sub),
                        if supertypes.is_empty() {
                            "no object".to_owned()
                        } else {
                            supertypes.join(" | ")
                        },
                        if lost == sub {
                            "it".to_owned()
                        } else {
                            format!("its subtype {}", name_of(program, lost))
                        },
                    );
                    found.push(UnsoundUse {
                        what,
                        types: (have, want),
                    });
                });
            }
            if found.len() == maximum {
                return;
            }
        }
    });
    let mut seen: FxHashSet<(TyId, TyId)> = FxHashSet::default();
    slices
        .into_iter()
        .flat_map(|slice| slice.1)
        .filter(|found| seen.insert(found.types))
        .take(maximum)
        .collect()
}

fn lost_subtype(
    program: &Program,
    subtypes: &[Cow<'_, [LayoutId]>],
    have: TyId,
    want: TyId,
) -> Option<(LayoutId, LayoutId)> {
    if program.tys.get(want).any_object
        || layouts_in(program, want).any(|sup| program.layouts[sup.idx()].accepts_untyped)
    {
        return None;
    }
    for sub in layouts_in(program, have) {
        let is_subset_of = |sup: LayoutId| {
            subtypes[sub.idx()]
                .iter()
                .all(|layout| subtypes[sup.idx()].binary_search(layout).is_ok())
        };
        if layouts_in(program, want).any(|sup| {
            sup == sub || !program.layouts[sub.idx()].accepts_untyped && is_subset_of(sup)
        }) {
            continue;
        }
        let lost = layouts_in(program, want).next().and_then(|sup| {
            subtypes[sub.idx()]
                .iter()
                .find(|layout| subtypes[sup.idx()].binary_search(layout).is_err())
        });
        return Some((sub, lost.copied().unwrap_or(sub)));
    }
    None
}

fn layouts_in(program: &Program, ty: TyId) -> impl Iterator<Item = LayoutId> + '_ {
    program.tys.get(ty).parts.iter().filter_map(|part| {
        if let Part::Class(layout) = part {
            layout.is_some().then_some(*layout)
        } else {
            None
        }
    })
}

fn name_of(program: &Program, layout: LayoutId) -> String {
    let name = program.layouts[layout.idx()].name;
    format!(
        "{}.{}",
        bstr::BStr::new(if name.is_none() {
            b"".as_slice()
        } else {
            program.strs.get(name)
        }),
        layout.idx()
    )
}

fn targets_of(term: Option<&Term>) -> SmallVec<[&Target; 2]> {
    match term {
        Some(Term::Jump(target)) => SmallVec::from_iter([target]),
        Some(Term::Branch {
            then, otherwise, ..
        }) => SmallVec::from_iter([then, otherwise]),
        Some(Term::Switch { cases, default, .. }) => {
            cases.iter().map(|case| &case.1).chain([default]).collect()
        }
        Some(Term::Throw { unwind, .. }) => unwind.iter().collect(),
        Some(Term::Invoke { normal, unwind }) => SmallVec::from_iter([normal, unwind]),
        Some(Term::Return(_) | Term::Unreachable) | None => SmallVec::new(),
    }
}

fn find_reachable_blocks(func: &Func, is_reached: &mut Vec<bool>, worklist: &mut Vec<usize>) {
    is_reached.clear();
    is_reached.resize(func.blocks.len(), false);
    if func.blocks.is_empty() {
        return;
    }
    is_reached[Func::ENTRY.idx()] = true;
    worklist.push(Func::ENTRY.idx());
    while let Some(block) = worklist.pop() {
        for target in targets_of(func.blocks[block].term.as_ref()) {
            if !std::mem::replace(&mut is_reached[target.block.idx()], true) {
                worklist.push(target.block.idx());
            }
        }
    }
}
