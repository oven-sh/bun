use crate::id::{GlobalId, StrId, V};
use crate::ir::{Def, Func, Op, Operation, Program, func_flags};
use bun_sema::util::{InParallel, for_each_mut};
use rustc_hash::FxHashSet;

const FUNCTIONS_PER_TASK: usize = 256;
const EVALUATING_GLOBALS: [&[u8]; 2] = [b"Function", b"eval"];
const VM_SPECIFIERS: [&[u8]; 2] = [b"node:vm", b"vm"];
const EVALUATING_VM_EXPORTS: [&[u8]; 6] = [b"Script", b"SourceTextModule", b"compileFunction", b"runInContext", b"runInNewContext", b"runInThisContext"];

pub(super) struct Site {
    pub module: u32,
    pub pos: u32,
    pub evaluator: Vec<u8>,
}

struct Names {
    evaluating_globals: Vec<StrId>,
    global_this: Option<StrId>,
    default: Option<StrId>,
    vm_specifiers: Vec<StrId>,
    evaluating_vm_exports: Vec<StrId>,
}

impl Names {
    fn is_vm_import(&self, func: &Func, v: V) -> bool {
        match func.op(v) {
            Some(Op::ExternalModule(specifier)) => self.vm_specifiers.contains(specifier),
            Some(Op::Operation { which: Operation::RequireExternalModule, args }) => {
                matches!(args.first().and_then(|&specifier| func.op(specifier)), Some(Op::Str(specifier)) if self.vm_specifiers.contains(specifier))
            }
            _ => false,
        }
    }

    fn is_vm(&self, func: &Func, v: V, vm_globals: &FxHashSet<GlobalId>) -> bool {
        match func.op(v) {
            Some(Op::GlobalGet(global)) => vm_globals.contains(global),
            Some(&Op::PropGet { obj, name }) if Some(name) == self.default => self.is_vm(func, obj, vm_globals),
            _ => self.is_vm_import(func, v),
        }
    }

    fn is_global_this(&self, func: &Func, v: V) -> bool {
        matches!(func.op(v), Some(Op::FreeGet { name, .. }) if Some(*name) == self.global_this)
    }

    fn evaluator(&self, func: &Func, callee: V, vm_globals: &FxHashSet<GlobalId>) -> Option<(bool, StrId)> {
        match func.op(callee) {
            Some(&Op::FreeGet { name, .. }) => self.evaluating_globals.contains(&name).then_some((false, name)),
            Some(&Op::PropGet { obj, name }) => self.evaluating_member(func, obj, name, vm_globals),
            _ => None,
        }
    }

    fn evaluating_member(&self, func: &Func, obj: V, name: StrId, vm_globals: &FxHashSet<GlobalId>) -> Option<(bool, StrId)> {
        if self.evaluating_globals.contains(&name) && self.is_global_this(func, obj) {
            return Some((false, name));
        }
        (self.evaluating_vm_exports.contains(&name) && self.is_vm(func, obj, vm_globals)).then_some((true, name))
    }
}

fn is_program_code(func: &Func) -> bool {
    func.flags & (func_flags::IS_BUILTIN | func_flags::IS_IN_BUILTIN_MODULE) == 0
}

pub(super) fn find_sites(program: &Program, in_parallel: InParallel<'_>) -> Vec<Site> {
    let find_all = |names: &[&[u8]]| -> Vec<StrId> { names.iter().filter_map(|name| program.strs.find(name)).collect() };
    let names = Names {
        evaluating_globals: find_all(&EVALUATING_GLOBALS),
        global_this: program.strs.find(b"globalThis"),
        default: program.strs.find(b"default"),
        vm_specifiers: find_all(&VM_SPECIFIERS),
        evaluating_vm_exports: find_all(&EVALUATING_VM_EXPORTS),
    };
    let mut holders: Vec<(&[Func], Vec<GlobalId>)> = program.funcs.chunks(FUNCTIONS_PER_TASK).map(|funcs| (funcs, Vec::new())).collect();
    if !names.vm_specifiers.is_empty() {
        for_each_mut(&mut holders, in_parallel, &|(funcs, found)| {
            for func in funcs.iter().filter(|func| is_program_code(func)) {
                found.extend(func.values.iter().filter_map(|value| match value.def {
                    Def::Op(Op::GlobalSet(global, stored)) if names.is_vm_import(func, stored) => Some(global),
                    _ => None,
                }));
            }
        });
    }
    let vm_globals: FxHashSet<GlobalId> = holders.into_iter().flat_map(|task| task.1).collect();
    let mut tasks: Vec<(&[Func], Vec<Site>)> = program.funcs.chunks(FUNCTIONS_PER_TASK).map(|funcs| (funcs, Vec::new())).collect();
    for_each_mut(&mut tasks, in_parallel, &|(funcs, found)| {
        for func in funcs.iter().filter(|func| is_program_code(func)) {
            for value in &func.values {
                let Def::Op(op) = &value.def else { continue };
                let shown = |(is_of_vm, name): (bool, StrId)| [if is_of_vm { b"vm.".as_slice() } else { b"" }, program.strs.get(name)].concat();
                let evaluator = match op {
                    Op::Operation { which: Operation::DirectEval, .. } => Some(b"eval".to_vec()),
                    &Op::Call { callee, .. } | &Op::Construct { callee, .. } => names.evaluator(func, callee, &vm_globals).map(shown),
                    &Op::CallMethod { obj, name, .. } => names.evaluating_member(func, obj, name, &vm_globals).map(shown),
                    _ => None,
                };
                found.extend(evaluator.map(|evaluator| Site { module: func.module.idx() as u32, pos: value.pos, evaluator }));
            }
        }
    });
    tasks.into_iter().flat_map(|task| task.1).collect()
}
