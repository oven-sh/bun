use crate::declared::{Declared, DeclaredTable, Part, prim};
use crate::id::{LayoutId, StrId, TyId, V};
use crate::ir::{
    CoerceReason, Def, Func, Layout, LayoutKind, Op, Operation, Prediction, Program, Strs,
    class_flags, field_flags,
};
use bun_sema::util::{InParallel, for_each_mut};
use rustc_hash::{FxHashMap, FxHashSet};
use std::sync::atomic::{AtomicUsize, Ordering};

const FUNCTIONS_PER_SLICE: usize = 256;
const KEYS_PER_SLICE: usize = 16;

fn ty_from_subtypes(
    tys: &DeclaredTable,
    layouts: &[Layout],
    supertypes_of: &[Vec<LayoutId>],
    stored_through: &FxHashSet<(LayoutId, StrId)>,
    view: LayoutId,
    name: StrId,
    is_on_object_prototype: bool,
) -> Option<Declared> {
    let looked_at = &layouts[view.idx()];
    if looked_at.accepts_untyped || looked_at.field(name).is_none() {
        return None;
    }
    let mut held = Declared::never();
    for &member in looked_at
        .members
        .iter()
        .chain(looked_at.members.is_empty().then_some(&view))
    {
        let of_member = &layouts[member.idx()];
        let own = of_member.field(name)?;
        let is_always_there = of_member.fields[own as usize].flags
            & (field_flags::OPTIONAL
                | field_flags::ABSENT_AT_CREATION
                | field_flags::NEVER_OBSERVED_ABSENT)
            == field_flags::NEVER_OBSERVED_ABSENT;
        if !is_always_there
            && (is_on_object_prototype
                || of_member.kind != LayoutKind::Record
                || of_member.class_flags & class_flags::MAY_HAVE_OTHER_PROTOTYPE != 0)
        {
            return None;
        }
        for &through in supertypes_of[member.idx()]
            .iter()
            .filter(|&&through| stored_through.contains(&(through, name)))
            .chain([&member])
        {
            let through = &layouts[through.idx()];
            let Some(field) = through.field(name) else {
                continue;
            };
            let declared = through.fields[field as usize].declared;
            if declared.is_none() || declared == tys.anything {
                return None;
            }
            held = held.or(tys.get(declared));
        }
    }
    Some(held)
}

pub(super) fn retype_reads_from_subtypes(
    program: &mut Program,
    in_parallel: InParallel<'_>,
) -> (usize, usize) {
    let Program {
        tys,
        funcs,
        layouts,
        strs,
        ..
    } = program;
    let mut supertypes_of: Vec<Vec<LayoutId>> = vec![Vec::new(); layouts.len()];
    for (view, layout) in layouts.iter().enumerate() {
        for member in &layout.members {
            supertypes_of[member.idx()].push(LayoutId(view as u32));
        }
    }
    let mut stored_through: FxHashSet<(LayoutId, StrId)> = FxHashSet::default();
    let is_on_object_prototype = |strs: &Strs, name: StrId| {
        super::NAMES_ON_OBJECT_PROTOTYPE
            .contains(&std::str::from_utf8(strs.get(name)).unwrap_or_default())
    };
    let mut described: FxHashMap<(LayoutId, StrId), Option<Declared>> = FxHashMap::default();
    {
        let (tys, layouts, strs) = (&*tys, &layouts[..], &*strs);
        let mut stores: Vec<(
            &[Func],
            FxHashSet<(LayoutId, StrId)>,
            Vec<(LayoutId, StrId)>,
        )> = funcs
            .chunks(FUNCTIONS_PER_SLICE)
            .map(|funcs| (funcs, FxHashSet::default(), Vec::new()))
            .collect();
        for_each_mut(&mut stores, in_parallel, &|(
            funcs,
            stored_through,
            keys,
        )| {
            let mut seen = FxHashSet::default();
            for func in funcs.iter() {
                let mut note = |obj: V, name: StrId| {
                    if func.ty(obj).is_some() {
                        stored_through.extend(tys.get(func.ty(obj)).parts.iter().filter_map(
                            |part| {
                                if let Part::Class(layout) = part {
                                    Some((*layout, name))
                                } else {
                                    None
                                }
                            },
                        ));
                    }
                };
                for value in &func.values {
                    match &value.def {
                        Def::Op(Op::PropSet { obj, name, .. }) => note(*obj, *name),
                        Def::Op(Op::Operation {
                            which: Operation::Initialize,
                            args,
                        }) => {
                            for store in args[1..].chunks_exact(2) {
                                if let Some(&Op::Str(name)) = func.op(store[0]) {
                                    note(args[0], name);
                                }
                            }
                        }
                        &Def::Op(Op::PropGet { obj, name })
                            if value.ty == tys.anything
                                || value.prediction() != Prediction::None =>
                        {
                            let receiver = func.ty(obj);
                            if let Some(view) = (if receiver.is_some() {
                                tys.get(receiver).single_layout()
                            } else {
                                None
                            }) && seen.insert((view, name))
                            {
                                keys.push((view, name));
                            }
                        }
                        _ => {}
                    }
                }
            }
        });
        let mut seen = FxHashSet::default();
        let mut all: Vec<(LayoutId, StrId)> = Vec::new();
        for slice in stores {
            stored_through.extend(slice.1);
            all.extend(slice.2.into_iter().filter(|&key| seen.insert(key)));
        }
        let mut created: Vec<(&[(LayoutId, StrId)], Vec<Option<Declared>>)> = all
            .chunks(KEYS_PER_SLICE)
            .map(|keys| (keys, Vec::new()))
            .collect();
        for_each_mut(&mut created, in_parallel, &|(keys, found)| {
            found.extend(keys.iter().map(|&(view, name)| {
                ty_from_subtypes(
                    tys,
                    layouts,
                    &supertypes_of,
                    &stored_through,
                    view,
                    name,
                    is_on_object_prototype(strs, name),
                )
            }));
        });
        for (keys, found) in created {
            described.extend(keys.iter().copied().zip(found));
        }
    }
    let (all_reads, all_coercions) = (AtomicUsize::new(0), AtomicUsize::new(0));
    let (layouts, strs) = (&layouts[..], &*strs);
    let mut unused = vec![false; funcs.len()];
    super::nullish::for_each_slice(
        tys,
        funcs,
        &mut unused,
        in_parallel,
        &|super::nullish::Slice { funcs, tys, .. }| {
            let mut known: FxHashMap<(LayoutId, StrId), TyId> = FxHashMap::default();
            let (mut reads, mut coercions) = (0, 0);
            for func in funcs.iter_mut() {
                for number in 0..func.values.len() {
                    match func.values[number].def {
                        Def::Op(Op::PropGet { obj, name })
                            if func.values[number].ty == tys.anything
                                || func.values[number].prediction() != Prediction::None =>
                        {
                            let receiver = func.ty(obj);
                            let Some(view) = (if receiver.is_some() {
                                tys.get(receiver).single_layout()
                            } else {
                                None
                            }) else {
                                continue;
                            };
                            let held = match known.get(&(view, name)) {
                                Some(&held) => held,
                                None => {
                                    let held = match described.get(&(view, name)) {
                                        Some(held) => held.clone(),
                                        None => ty_from_subtypes(
                                            tys.known(),
                                            layouts,
                                            &supertypes_of,
                                            &stored_through,
                                            view,
                                            name,
                                            is_on_object_prototype(strs, name),
                                        ),
                                    };
                                    let held = held.map_or(TyId::NONE, |held| tys.intern(held));
                                    known.insert((view, name), held);
                                    held
                                }
                            };
                            let own = func.values[number].ty;
                            if held.is_some()
                                && held != own
                                && (own == tys.anything
                                    || own.is_some() && tys.get(held).is_subset_of(tys.get(own)))
                            {
                                func.values[number].ty = held;
                                func.values[number].set_prediction(Prediction::None);
                                reads += 1;
                            }
                        }
                        Def::Op(Op::Coerce {
                            value,
                            to,
                            why: CoerceReason::Coerce,
                        }) => {
                            let have = func.ty(value);
                            if value.idx() < number
                                && have.is_some()
                                && have != tys.anything
                                && to.is_some()
                                && tys.get(have).is_subset_of(tys.get(to))
                            {
                                func.values[number].def = Def::Op(Op::Coerce {
                                    value,
                                    to: have,
                                    why: CoerceReason::Upcast,
                                });
                                func.values[number].ty = have;
                                coercions += 1;
                            }
                        }
                        _ => {}
                    }
                }
                coercions += defer_to_following_cast(tys, func);
            }
            all_reads.fetch_add(reads, Ordering::Relaxed);
            all_coercions.fetch_add(coercions, Ordering::Relaxed);
        },
    );
    (all_reads.into_inner(), all_coercions.into_inner())
}

fn defer_to_following_cast(tys: &super::nullish::Overlay<'_>, func: &mut Func) -> usize {
    let mut uses: Vec<u32> = Vec::new();
    let mut left = 0;
    for number in 0..func.values.len() {
        let Def::Op(Op::Coerce {
            value: coerced,
            to,
            why: CoerceReason::Cast,
        }) = func.values[number].def
        else {
            continue;
        };
        let Some(&Op::Coerce {
            value,
            to: tried,
            why: CoerceReason::Coerce,
        }) = func.op(coerced)
        else {
            continue;
        };
        let have = func.ty(value);
        if have.is_none() || have == tys.anything || tried.is_none() || to.is_none() {
            continue;
        }
        if uses.is_empty() {
            uses.resize(func.values.len(), 0);
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
        }
        if uses[coerced.idx()] != 1 {
            continue;
        }
        let (had, tried, written) = (tys.get(have), tys.get(tried), tys.get(to));
        let is_program_defined = |described: &Declared| {
            !described.parts.is_empty()
                && described
                    .parts
                    .iter()
                    .all(|part| matches!(part, Part::Class(_)))
                && !described.any_object
                && !described.any_function
                && described.prims & !prim::NULLISH == 0
                && described.ints.is_none()
        };
        if is_program_defined(had)
            && is_program_defined(tried)
            && tried.parts == written.parts
            && is_program_defined(written)
        {
            func.values[number].def = Def::Op(Op::Coerce {
                value,
                to,
                why: CoerceReason::Cast,
            });
            func.values[coerced.idx()].def = Def::Op(Op::Coerce {
                value,
                to: have,
                why: CoerceReason::Upcast,
            });
            func.values[coerced.idx()].ty = have;
            left += 1;
        }
    }
    left
}
