use crate::id::StrId;
use crate::ir::{Def, Func, Op, Program, func_flags};
use bun_sema::util::{InParallel, for_each_mut};

const FUNCTIONS_PER_TASK: usize = 256;

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(super) struct Site {
    pub module: u32,
    pub pos: u32,
    pub name: StrId,
    pub is_call: bool,
}

pub(super) fn find_sites(program: &Program, is_wanted_module: &[bool], in_parallel: InParallel<'_>) -> Vec<Site> {
    let mut tasks: Vec<(&[Func], Vec<Site>)> = program.funcs.chunks(FUNCTIONS_PER_TASK).map(|funcs| (funcs, Vec::new())).collect();
    for_each_mut(&mut tasks, in_parallel, &|(funcs, found)| {
        let is_searched = |func: &&Func| func.flags & func_flags::IS_TYPED != 0 && func.flags & (func_flags::IS_BUILTIN | func_flags::IS_IN_BUILTIN_MODULE) == 0 && func.module.is_some() && is_wanted_module[func.module.idx()];
        for func in funcs.iter().filter(is_searched) {
            for value in &func.values {
                let (obj, name, is_call) = match value.def {
                    Def::Op(Op::PropGet { obj, name }) => (obj, name, false),
                    Def::Op(Op::CallMethod { obj, name, .. }) => (obj, name, true),
                    _ => continue,
                };
                let receiver = func.values[obj.idx()].ty;
                if !matches!(func.op(obj), Some(Op::FreeGet { .. })) && (receiver.is_none() || program.tys.get(receiver).any_object) {
                    found.push(Site { module: func.module.idx() as u32, pos: value.pos, name, is_call });
                }
            }
        }
    });
    let mut sites: Vec<Site> = tasks.into_iter().flat_map(|task| task.1).collect();
    sites.sort_unstable();
    sites.dedup();
    sites
}
