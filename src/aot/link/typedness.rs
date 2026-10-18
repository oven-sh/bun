use crate::declared::Part;
use crate::id::LayoutId;
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
    pub own_reads: usize,
    pub own_typed_reads: usize,
    pub layouts: usize,
    pub open_layouts: usize,
    pub classes_without_layout: usize,
    pub untyped_packages: usize,
    pub untyped_files: usize,
}

pub(super) fn measure(program: &Program, is_runtime_layout: &[bool], fixable_reads_by_name: usize, modules: &[FileId], checked: &Checked<'_>, in_parallel: InParallel<'_>) -> Typedness {
    let is_own = |layout: LayoutId| layout.is_some() && program.layouts[layout.idx()].kind != LayoutKind::Environment && !is_runtime_layout.get(layout.idx()).copied().unwrap_or(false);
    let has_known_layout = |layout: LayoutId| {
        let layout = &program.layouts[layout.idx()];
        !layout.accepts_untyped && (layout.kind != LayoutKind::Instance || layout.class_flags & class_flags::HAS_FIXED_LAYOUT != 0)
    };
    let is_untyped_code_of_program = |file: FileId| {
        let module = checked.files.module(file);
        module.builtin.is_none() && module.is_untyped() && !bun_core::strings::contains(module.path.text, b"/.bun-aot-prelude/")
    };
    let is_in_package = |file: FileId| checked.files.module(file).is_dependency && checked.files.module(file).package_directory.is_some();
    let is_untyped_file: Vec<bool> = modules.iter().map(|&file| is_untyped_code_of_program(file) && !is_in_package(file)).collect();
    let mut tasks: Vec<(&[Func], [usize; 4])> = program.funcs.chunks(FUNCTIONS_PER_TASK).map(|funcs| (funcs, [0; 4])).collect();
    for_each_mut(&mut tasks, in_parallel, &|(funcs, [reads, typed_reads, own_reads, own_typed_reads])| {
        for func in funcs.iter().filter(|func| func.flags & (func_flags::IS_BUILTIN | func_flags::IS_IN_BUILTIN_MODULE) == 0) {
            if func.flags & func_flags::IS_TYPED == 0 {
                if func.module.is_some() && is_untyped_file[func.module.idx()] {
                    let reads_a_property = |def: &Def| matches!(*def, Def::Op(Op::PropGet { obj, .. }) if !matches!(func.op(obj), Some(Op::FreeGet { .. })));
                    *own_reads += func.values.iter().filter(|value| reads_a_property(&value.def)).count();
                }
                continue;
            }
            for value in &func.values {
                if let Def::Op(Op::PropGet { .. } | Op::ElemGet { .. }) = value.def {
                    *reads += 1;
                    *typed_reads += usize::from(value.ty.is_some() && value.ty != program.tys.anything);
                }
                let Def::Op(Op::PropGet { obj, .. } | Op::FieldGet { obj, .. }) = value.def else { continue };
                if func.ty(obj).is_none() || program.tys.get(func.ty(obj)).any_object {
                    continue;
                }
                let mut own_layouts = program.tys.get(func.ty(obj)).parts.iter().filter_map(|part| match *part {
                    Part::Class(layout) if is_own(layout) => Some(layout),
                    _ => None,
                });
                if let Some(first) = own_layouts.next() {
                    *own_reads += 1;
                    *own_typed_reads += usize::from(has_known_layout(first) && own_layouts.all(has_known_layout));
                }
            }
        }
    });
    let mut found = Typedness { own_reads: fixable_reads_by_name, ..Typedness::default() };
    for (_, [reads, typed_reads, own_reads, own_typed_reads]) in tasks {
        found.reads += reads;
        found.typed_reads += typed_reads;
        found.own_reads += own_reads;
        found.own_typed_reads += own_typed_reads;
    }
    for (_, layout) in program.layouts.iter().enumerate().filter(|&(index, layout)| layout.kind != LayoutKind::Environment && !is_runtime_layout.get(index).copied().unwrap_or(false)) {
        found.layouts += 1;
        found.open_layouts += usize::from(layout.accepts_untyped);
        found.classes_without_layout += usize::from(layout.kind == LayoutKind::Instance && layout.class_flags & (class_flags::HAS_FIXED_LAYOUT | class_flags::HAS_FIXED_MEMBERS) == class_flags::HAS_FIXED_MEMBERS);
    }
    let mut untyped_packages: FxHashSet<Atom> = FxHashSet::default();
    for &file in modules.iter().filter(|&&file| is_untyped_code_of_program(file)) {
        if is_in_package(file) {
            untyped_packages.insert(checked.files.module(file).package_directory);
        } else {
            found.untyped_files += 1;
        }
    }
    found.untyped_packages = untyped_packages.len();
    found
}
