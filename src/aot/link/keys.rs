use crate::declared::{Declared, Part, prim};
use crate::id::V;
use crate::ir::{Def, Func, Op, Operation, Program, class_flags};
use bun_sema::program::FileId;
use bun_sema::util::{InParallel, for_each_mut};

const FUNCTIONS_PER_TASK: usize = 256;

fn layouts_of_own_objects(program: &Program) -> Vec<bool> {
    let may_be_foreign = |flags: u32| flags & (class_flags::HAS_UNTYPED_BASE | class_flags::MAY_HAVE_OTHER_PROTOTYPE) != 0;
    let mut is_own: Vec<bool> = program.layouts.iter().map(|layout| !layout.accepts_untyped && !may_be_foreign(layout.class_flags)).collect();
    loop {
        let mut has_changed = false;
        for (index, layout) in program.layouts.iter().enumerate() {
            let mut related = Some(layout.base).filter(|base| base.is_some()).into_iter().chain(layout.members.iter().copied()).chain(layout.structural_subtypes.iter().copied()).chain(layout.specializations.iter().copied());
            if is_own[index] && related.any(|other| !is_own[other.idx()]) {
                is_own[index] = false;
                has_changed = true;
            }
        }
        if !has_changed {
            return is_own;
        }
    }
}

fn may_be_a_name(key: &Declared) -> bool {
    key.prims & (prim::STRING | prim::LITERAL_STRING) != 0 || key.has_objects()
}

fn is_own_object(receiver: &Declared, is_own: &[bool]) -> bool {
    receiver.prims & !prim::NULLISH == 0 && receiver.ints.is_none() && !receiver.any_object && !receiver.any_function && receiver.parts.iter().all(|part| matches!(part, Part::Class(layout) if layout.is_some() && is_own[layout.idx()]))
}

fn read_by_key(func: &Func, op: &Op) -> Option<(V, V)> {
    match op {
        &Op::ElemGet { obj, key } => Some((obj, key)),
        Op::Operation { which: Operation::SuperGet | Operation::GetOwnProperty, args } => Some((args[0], args[1])),
        Op::Operation { which: Operation::GetByValWithThis, args } => Some((args[0], args[2])),
        _ => None,
    }
    .filter(|&(_, key)| !matches!(func.op(key), Some(Op::Str(_) | Op::Int(_) | Op::Symbol(_))))
}

pub(super) fn reads_of_any_property(program: &Program, modules: &[FileId], in_parallel: InParallel<'_>) -> Vec<(FileId, u32)> {
    let is_own = layouts_of_own_objects(program);
    let mut tasks: Vec<(&[Func], Vec<(FileId, u32)>)> = program.funcs.chunks(FUNCTIONS_PER_TASK).map(|funcs| (funcs, Vec::new())).collect();
    for_each_mut(&mut tasks, in_parallel, &|(funcs, found)| {
        for func in funcs.iter().filter(|func| func.module.is_some()) {
            for value in &func.values {
                if let Def::Op(op) = &value.def
                    && let Some((obj, key)) = read_by_key(func, op)
                    && may_be_a_name(program.tys.get(func.ty(key)))
                    && !is_own_object(program.tys.get(func.ty(obj)), &is_own)
                {
                    found.push((modules[func.module.idx()], value.pos));
                }
            }
        }
    });
    tasks.into_iter().flat_map(|task| task.1).collect()
}
