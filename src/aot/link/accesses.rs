use crate::declared::Part;
use crate::id::{LayoutId, StrId, V};
use crate::ir::{AccessByName, Def, Func, Layout, LayoutKind, Op, Program, class_flags, func_flags, method_flags};
use bun_sema::check::{ObjectOrigin, Program as Checked};
use bun_sema::program::FileId;

#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum Verdict {
    Typed,
    ThroughLayout(LayoutId),
    ByName(AccessByName),
    InUntypedCode(AccessByName),
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum Kind {
    Read,
    Store,
    Call,
}

#[derive(Copy, Clone)]
pub(super) struct Access {
    pub value: V,
    pub block: usize,
    pub kind: Kind,
    pub verdict: Verdict,
    pub is_in_dependency: bool,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Code {
    NotCounted,
    Typed,
    Untyped,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Shape {
    NotCounted,
    Known,
    Unknown,
    UnknownBecauseOfPackage,
}

pub(super) struct Accesses<'a> {
    program: &'a Program,
    shape_of_layout: Vec<Shape>,
    code_of_module: Vec<Code>,
    is_dependency: Vec<bool>,
}

impl<'a> Accesses<'a> {
    pub(super) fn has_known_shape(layout: &Layout) -> bool {
        !layout.accepts_untyped && (layout.kind != LayoutKind::Instance || layout.class_flags & class_flags::HAS_FIXED_LAYOUT != 0)
    }

    pub(super) fn new(program: &'a Program, is_runtime_layout: &[bool], origin_of_unknown_shape: &[ObjectOrigin], modules: &[FileId], checked: &Checked<'_>) -> Accesses<'a> {
        let shape_of_layout = (program.layouts.iter().enumerate())
            .map(|(index, layout)| match origin_of_unknown_shape[index] {
                _ if layout.kind == LayoutKind::Environment || is_runtime_layout.get(index).copied().unwrap_or(false) => Shape::NotCounted,
                _ if Accesses::has_known_shape(layout) => Shape::Known,
                ObjectOrigin::Runtime => Shape::NotCounted,
                ObjectOrigin::Package => Shape::UnknownBecauseOfPackage,
                ObjectOrigin::Program => Shape::Unknown,
            })
            .collect();
        let code_of = |file: FileId| {
            let module = checked.files.module(file);
            match module.builtin.is_some() || bun_core::strings::contains(module.path.text, b"/.bun-aot-prelude/") {
                true => Code::NotCounted,
                false if module.is_untyped() => Code::Untyped,
                false => Code::Typed,
            }
        };
        let is_dependency = |file: FileId| checked.files.module(file).is_dependency && checked.files.module(file).package_directory.is_some();
        Accesses { program, shape_of_layout, code_of_module: modules.iter().map(|&file| code_of(file)).collect(), is_dependency: modules.iter().map(|&file| is_dependency(file)).collect() }
    }

    fn declares(&self, layout: LayoutId, name: StrId) -> bool {
        let is_method = |layout: LayoutId| self.program.layouts[layout.idx()].methods.iter().any(|method| method.name == name && method.flags & method_flags::STATIC == 0);
        self.program.layouts[layout.idx()].field(name).is_some() || std::iter::successors(Some(layout), |layout| Some(self.program.layouts[layout.idx()].base).filter(|base| base.is_some())).any(is_method)
    }

    pub(super) fn for_each_in(&self, func: &Func, mut visit: impl FnMut(Access)) {
        if func.flags & (func_flags::IS_BUILTIN | func_flags::IS_IN_BUILTIN_MODULE) != 0 || func.module.is_none() {
            return;
        }
        let is_typed = func.flags & func_flags::IS_TYPED != 0;
        match self.code_of_module[func.module.idx()] {
            Code::NotCounted => return,
            Code::Typed if !is_typed => return,
            Code::Untyped if func.accesses_by_name.is_empty() => return,
            Code::Typed | Code::Untyped => {}
        }
        let is_in_dependency = self.is_dependency[func.module.idx()];
        let noted = |value: V| func.accesses_by_name.binary_search_by_key(&value, |access| access.value).ok().map(|index| func.accesses_by_name[index]);
        for (block, contents) in func.blocks.iter().enumerate() {
            for &value in &contents.ops {
                let (obj, name, kind) = match func.values[value.idx()].def {
                    Def::Op(Op::PropGet { obj, name }) => (obj, name, Kind::Read),
                    Def::Op(Op::PropSet { obj, name, .. }) => (obj, name, Kind::Store),
                    Def::Op(Op::CallMethod { obj, name, .. }) => (obj, name, Kind::Call),
                    _ => continue,
                };
                let receiver = func.ty(obj);
                let verdict = if is_typed && receiver.is_some() && !self.program.tys.get(receiver).any_object {
                    let mut own_layouts = self.program.tys.get(receiver).parts.iter().filter_map(|part| match *part {
                        Part::Class(layout) if layout.is_some() && self.shape_of_layout[layout.idx()] != Shape::NotCounted => Some(layout),
                        _ => None,
                    });
                    let Some(first) = own_layouts.next() else { continue };
                    let own_layouts = [first].into_iter().chain(own_layouts);
                    if !own_layouts.clone().all(|layout| self.declares(layout, name)) {
                        continue;
                    }
                    match own_layouts.clone().find(|layout| self.shape_of_layout[layout.idx()] != Shape::Known) {
                        Some(layout) => Verdict::ThroughLayout(layout),
                        None => Verdict::Typed,
                    }
                } else {
                    let Some(access) = noted(value) else { continue };
                    if is_typed { Verdict::ByName(access) } else { Verdict::InUntypedCode(access) }
                };
                let is_of_package = match verdict {
                    Verdict::ByName(access) | Verdict::InUntypedCode(access) => access.origin == ObjectOrigin::Package,
                    Verdict::ThroughLayout(layout) => self.shape_of_layout[layout.idx()] == Shape::UnknownBecauseOfPackage,
                    Verdict::Typed => false,
                };
                visit(Access { value, block, kind, verdict, is_in_dependency: is_in_dependency || is_of_package });
            }
        }
    }
}
