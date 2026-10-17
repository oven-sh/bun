use crate::ir::{Def, Func, LayoutKind, Op, Program, class_flags, func_flags};
use bun_sema::atom::Atom;
use bun_sema::check::Program as Checked;
use bun_sema::program::FileId;
use bun_sema::util::{InParallel, for_each_mut};
use rustc_hash::FxHashSet;

const FUNCTIONS_PER_TASK: usize = 256;

#[derive(Default, Copy, Clone)]
pub struct Typedness {
    pub reads: usize,
    pub typed_reads: usize,
    pub layouts: usize,
    pub open_layouts: usize,
    pub classes_without_layout: usize,
    pub untyped_packages: usize,
    pub untyped_files: usize,
}

pub(super) fn measure(program: &Program, is_runtime_layout: &[bool], modules: &[FileId], checked: &Checked<'_>, in_parallel: InParallel<'_>) -> Typedness {
    let mut tasks: Vec<(&[Func], [usize; 2])> = program.funcs.chunks(FUNCTIONS_PER_TASK).map(|funcs| (funcs, [0; 2])).collect();
    for_each_mut(&mut tasks, in_parallel, &|(funcs, [reads, typed_reads])| {
        let is_counted = |func: &&Func| func.flags & func_flags::IS_TYPED != 0 && func.flags & (func_flags::IS_BUILTIN | func_flags::IS_IN_BUILTIN_MODULE) == 0;
        for value in funcs.iter().filter(is_counted).flat_map(|func| &func.values) {
            if let Def::Op(Op::PropGet { .. } | Op::ElemGet { .. }) = value.def {
                *reads += 1;
                *typed_reads += usize::from(value.ty.is_some() && value.ty != program.tys.anything);
            }
        }
    });
    let mut found = Typedness::default();
    for (_, [reads, typed_reads]) in tasks {
        found.reads += reads;
        found.typed_reads += typed_reads;
    }
    for (_, layout) in program.layouts.iter().enumerate().filter(|&(index, layout)| layout.kind != LayoutKind::Environment && !is_runtime_layout.get(index).copied().unwrap_or(false)) {
        found.layouts += 1;
        found.open_layouts += usize::from(layout.accepts_untyped);
        found.classes_without_layout += usize::from(layout.kind == LayoutKind::Instance && layout.class_flags & (class_flags::HAS_FIXED_LAYOUT | class_flags::HAS_FIXED_MEMBERS) == class_flags::HAS_FIXED_MEMBERS);
    }
    let mut untyped_packages: FxHashSet<Atom> = FxHashSet::default();
    for module in modules.iter().map(|&file| checked.files.module(file)).filter(|module| module.builtin.is_none() && module.is_untyped() && !bun_core::strings::contains(module.path.text, b"/.bun-aot-prelude/")) {
        if module.is_dependency && module.package_directory.is_some() {
            untyped_packages.insert(module.package_directory);
        } else {
            found.untyped_files += 1;
        }
    }
    found.untyped_packages = untyped_packages.len();
    found
}
