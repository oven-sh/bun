use crate::declared::{Declared, Part, prim};
use crate::id::{FuncId, LayoutId, StrId, V};
use crate::ir::{Field, FuncKind, Global, Initialization, LayoutKind, Op, Program, Term, class_flags, field_flags, func_flags};
use smallvec::SmallVec;

pub(super) fn mark_environment_releases(program: &mut Program, contents: &[u8], in_parallel: bun_sema::util::InParallel<'_>) -> usize {
    const FUNCTIONS_PER_TASK: usize = 256;
    let is_candidate: Vec<bool> = program.layouts.iter().map(|layout| layout.kind == LayoutKind::Environment && layout.class_flags & class_flags::MAY_BE_REUSED != 0).collect();
    let mut allocation_sites: Vec<SmallVec<[(usize, usize, V, bool); 1]>> = vec![SmallVec::new(); program.layouts.len()];
    let mut tasks: Vec<(usize, &[crate::ir::Func], Vec<(LayoutId, usize, usize, V, bool)>)> = program.funcs.chunks(FUNCTIONS_PER_TASK).enumerate().map(|(number, funcs)| (number * FUNCTIONS_PER_TASK, funcs, Vec::new())).collect();
    bun_sema::util::for_each_mut(&mut tasks, in_parallel, &|(first, funcs, found)| {
        for (function, func) in funcs.iter().enumerate().filter(|function| contents[*first + function.0] & super::has::NEW_OBJECTS != 0) {
            let is_plain_call = matches!(func.kind, FuncKind::Plain | FuncKind::Arrow | FuncKind::Method) && func.flags & (func_flags::ASYNC | func_flags::GENERATOR) == 0;
            for (block, at) in func.blocks.iter().enumerate().flat_map(|(block, it)| it.ops.iter().map(move |&at| (block, at))) {
                if let Some(&(Op::New(layout) | Op::NewWith { layout, .. })) = func.op(at)
                    && is_candidate[layout.idx()]
                {
                    found.push((layout, *first + function, block, at, is_plain_call && matches!(func.op(at), Some(Op::New(_)))));
                }
            }
        }
    });
    for (layout, function, block, at, may_be_marked) in tasks.into_iter().flat_map(|task| task.2) {
        allocation_sites[layout.idx()].push((function, block, at, may_be_marked));
    }
    let (yes, no, boolean, undefined) = (
        program.tys.intern(Declared::prims(prim::TRUE)),
        program.tys.intern(Declared::prims(prim::FALSE)),
        program.tys.intern(Declared::prims(prim::BOOLEAN)),
        program.tys.intern(Declared::prims(prim::UNDEFINED)),
    );
    let name = program.strs.intern(b"environment");
    let mut marked: Vec<(usize, V, LayoutId, u32)> = Vec::new();
    for (number, allocation_sites) in allocation_sites.iter().enumerate() {
        program.layouts[number].class_flags &= !class_flags::MAY_BE_REUSED;
        let [(function, 0, environment, true)] = allocation_sites[..] else { continue };
        let id = LayoutId::new(number);
        let held = program.tys.intern(Declared { prims: prim::UNDEFINED, ..Declared::part(Part::Class(id)) });
        let module = program.funcs[function].module;
        let layout = &mut program.layouts[number];
        layout.class_flags |= class_flags::MAY_BE_REUSED;
        layout.environment = LayoutId::new(program.globals.len());
        let has_escaped = layout.fields.len() as u32;
        layout.fields.push(Field::new(StrId::NONE, boolean, field_flags::NEVER_READ_UNINITIALIZED));
        layout.fields.push(Field::new(StrId::NONE, boolean, field_flags::NEVER_READ_UNINITIALIZED));
        program.globals.push(Global { name, module, declared: held, initialization: Initialization::Undefined, single_function: FuncId::NONE, single_function_flags: 0 });
        marked.push((function, environment, id, has_escaped));
    }
    let count = marked.len();
    marked.sort_by_key(|mark| mark.0);
    let mut tasks: Vec<(usize, &mut [crate::ir::Func], &[(usize, V, LayoutId, u32)])> = Vec::new();
    let mut remaining = &marked[..];
    for (number, funcs) in program.funcs.chunks_mut(FUNCTIONS_PER_TASK).enumerate() {
        let (of_task, later) = remaining.split_at(remaining.partition_point(|mark| mark.0 < (number + 1) * FUNCTIONS_PER_TASK));
        remaining = later;
        if !of_task.is_empty() {
            tasks.push((number * FUNCTIONS_PER_TASK, funcs, of_task));
        }
    }
    bun_sema::util::for_each_mut(&mut tasks, in_parallel, &|(first, funcs, marked)| {
        for &(function, environment, id, has_escaped) in marked.iter() {
            let func = &mut funcs[function - *first];
            let pos = func.values[environment.idx()].pos;
            let value = func.add_value(Op::Bool(false), pos, no);
            let store = func.add_value(Op::FieldSet { obj: environment, layout: id, field: has_escaped, value }, pos, undefined);
            let at = func.blocks[0].ops.iter().position(|&op| op == environment).unwrap() + 1;
            func.blocks[0].ops.splice(at..at, [value, store]);
            for block in 0..func.blocks.len() {
                if !matches!(func.blocks[block].term, Some(Term::Return(_))) {
                    continue;
                }
                let value = func.add_value(Op::Bool(true), 0, yes);
                let store = func.add_value(Op::FieldSet { obj: environment, layout: id, field: has_escaped + 1, value }, 0, undefined);
                func.blocks[block].ops.extend([value, store]);
            }
        }
    });
    count
}
