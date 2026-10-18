use super::accesses::{Accesses, Verdict};
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
    pub accesses: usize,
    pub typed_accesses: usize,
    pub dependency_accesses: usize,
    pub typed_dependency_accesses: usize,
    pub layouts: usize,
    pub open_layouts: usize,
    pub classes_without_layout: usize,
    pub untyped_packages: usize,
    pub untyped_files: usize,
}

fn with_commas(n: usize) -> String {
    let digits = n.to_string();
    let mut out = String::new();
    for (i, digit) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(digit);
    }
    out
}

fn share(typed: usize, all: usize) -> String {
    match typed == all {
        true => "100%".to_owned(),
        false => format!("{}.{}%", 100 * typed / all, 1000 * typed / all % 10),
    }
}

impl Typedness {
    const WORTH_EXPLAINING_BELOW_PERCENT: usize = 95;

    pub fn summary(&self) -> String {
        let Typedness { accesses, typed_accesses, dependency_accesses, typed_dependency_accesses, .. } = *self;
        let mut summary = format!("{} typed", share(typed_accesses, accesses));
        if typed_accesses < accesses {
            summary.push_str(&format!(" ({} of {} property accesses)", with_commas(typed_accesses), with_commas(accesses)));
        }
        if dependency_accesses > 0 {
            summary.push_str(&format!(", dependencies {} ({} of {})", share(typed_dependency_accesses, dependency_accesses), with_commas(typed_dependency_accesses), with_commas(dependency_accesses)));
        }
        summary
    }

    pub fn is_worth_explaining(&self) -> bool {
        100 * self.typed_accesses < Typedness::WORTH_EXPLAINING_BELOW_PERCENT * self.accesses
    }
}

pub(super) fn measure(program: &Program, accesses: &Accesses<'_>, is_runtime_layout: &[bool], modules: &[FileId], checked: &Checked<'_>, in_parallel: InParallel<'_>) -> Typedness {
    let mut tasks: Vec<(&[Func], Typedness)> = program.funcs.chunks(FUNCTIONS_PER_TASK).map(|funcs| (funcs, Typedness::default())).collect();
    for_each_mut(&mut tasks, in_parallel, &|(funcs, counted)| {
        let is_counted = |func: &&Func| func.flags & func_flags::IS_TYPED != 0 && func.flags & (func_flags::IS_BUILTIN | func_flags::IS_IN_BUILTIN_MODULE | func_flags::IS_HIDDEN_IN_STACK_TRACES) == 0;
        for value in funcs.iter().filter(is_counted).flat_map(|func| &func.values) {
            if let Def::Op(Op::PropGet { .. } | Op::ElemGet { .. }) = value.def {
                counted.reads += 1;
                counted.typed_reads += usize::from(value.ty.is_some() && value.ty != program.tys.anything);
            }
        }
        for func in funcs.iter() {
            accesses.for_each_in(func, |access| {
                let (all, typed) = if access.is_in_dependency { (&mut counted.dependency_accesses, &mut counted.typed_dependency_accesses) } else { (&mut counted.accesses, &mut counted.typed_accesses) };
                *all += 1;
                *typed += usize::from(access.verdict == Verdict::Typed);
            });
        }
    });
    let mut found = Typedness::default();
    for (_, counted) in tasks {
        found.reads += counted.reads;
        found.typed_reads += counted.typed_reads;
        found.accesses += counted.accesses;
        found.typed_accesses += counted.typed_accesses;
        found.dependency_accesses += counted.dependency_accesses;
        found.typed_dependency_accesses += counted.typed_dependency_accesses;
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
