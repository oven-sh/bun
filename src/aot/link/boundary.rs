use super::nil::{fields_named, functions_called};
use crate::declared::Part;
use crate::id::{FuncId, LayoutId, StrId, TyId, V};
use crate::ir::{Func, LayoutKind, Op, Program, Term, func_flags};

fn add_layouts_in(program: &Program, ty: TyId, depth: u32, out: &mut Vec<LayoutId>) {
    if ty.is_none() || depth > 4 {
        return;
    }
    for part in &program.tys.get(ty).parts {
        match part {
            Part::Class(layout) => {
                if layout.is_some() {
                    out.push(*layout);
                }
            }
            Part::Array(element) => add_layouts_in(program, *element, depth + 1, out),
            Part::Global(_, arguments) => {
                for &argument in arguments {
                    add_layouts_in(program, argument, depth + 1, out);
                }
            }
        }
    }
}

fn says_nothing(program: &Program, ty: TyId) -> bool {
    ty.is_none() || ty == program.tys.anything || program.tys.get(ty).any_object
}

fn views_of(program: &Program, ty: TyId) -> Vec<LayoutId> {
    if ty.is_none() {
        return Vec::new();
    }
    program.tys.get(ty).parts.iter().filter_map(|part| if let Part::Class(layout) = part { layout.is_some().then_some(*layout) } else { None }).collect()
}

fn is_ours(program: &Program, callee: FuncId) -> bool {
    program.funcs[callee.idx()].flags & (func_flags::IS_TYPED | func_flags::IS_BUILTIN | func_flags::IS_OF_BUILTIN_MODULE) != 0
}

struct Outbound<'a> {
    program: &'a Program,
    is_out: Vec<bool>,
    pending: Vec<LayoutId>,
    doors: usize,
}

impl Outbound<'_> {
    fn view(&mut self, view: LayoutId) {
        let program = self.program;
        for &member in program.layouts[view.idx()].members.iter().chain(std::iter::once(&view)) {
            if program.layouts[member.idx()].is_allocated && !self.is_out[member.idx()] {
                self.is_out[member.idx()] = true;
                self.pending.push(member);
            }
        }
    }

    fn ty(&mut self, ty: TyId) -> bool {
        let mut layouts = Vec::new();
        add_layouts_in(self.program, ty, 0, &mut layouts);
        for &layout in &layouts {
            self.view(layout);
        }
        !layouts.is_empty()
    }

    fn values(&mut self, func: &Func, values: &[V]) {
        let mut is_door = false;
        for &value in values {
            if value.is_some() {
                is_door |= self.ty(func.ty(value));
            }
        }
        self.doors += usize::from(is_door);
    }

    fn close(&mut self) {
        let program = self.program;
        while let Some(layout) = self.pending.pop() {
            for field in &program.layouts[layout.idx()].fields {
                self.ty(field.declared);
            }
        }
    }

    fn count(&self) -> usize {
        self.is_out.iter().filter(|&&is_out| is_out).count()
    }
}

fn handed_to_places_that_say_nothing(program: &Program, callee: FuncId, as_the_entry_takes_them: bool, args: &[V]) -> Vec<V> {
    let called = &program.funcs[callee.idx()];
    let Some(entry) = called.blocks.first() else { return Vec::new() };
    let ahead = if as_the_entry_takes_them { 0 } else { called.captures.len() + usize::from(called.has(func_flags::HAS_THIS)) };
    args.iter().enumerate().filter(|(index, _)| entry.params.get(index + ahead).is_none_or(|&parameter| says_nothing(program, called.ty(parameter)))).map(|(_, &argument)| argument).collect()
}

fn outbound(program: &Program, is_wide: bool) -> (Vec<bool>, usize, usize) {
    let mut out = Outbound { program, is_out: vec![false; program.layouts.len()], pending: Vec::new(), doors: 0 };
    for func in &program.funcs {
        for &v in func.blocks.iter().flat_map(|block| &block.ops) {
            match func.op(v) {
                Some(Op::CallDirect { func: callee, args }) => {
                    if !is_ours(program, *callee) {
                        out.values(func, args);
                    } else if is_wide {
                        out.values(func, &handed_to_places_that_say_nothing(program, *callee, true, args));
                    }
                }
                Some(Op::Call { callee, this, args }) => match functions_called(program, func, v) {
                    Some((found, _)) => {
                        for &known in &found {
                            if !is_ours(program, known) {
                                out.values(func, args);
                                out.values(func, &[*this]);
                            } else if is_wide {
                                out.values(func, &handed_to_places_that_say_nothing(program, known, false, args));
                            }
                        }
                    }
                    None => {
                        if is_wide || says_nothing(program, func.ty(*callee)) {
                            out.values(func, args);
                            out.values(func, &[*this]);
                        }
                    }
                },
                Some(Op::CallMethod { obj, args, .. }) => match functions_called(program, func, v) {
                    Some((found, _)) => {
                        for &known in &found {
                            if !is_ours(program, known) {
                                out.values(func, args);
                                out.values(func, &[*obj]);
                            } else if is_wide {
                                out.values(func, &handed_to_places_that_say_nothing(program, known, false, args));
                            }
                        }
                    }
                    None => {
                        if is_wide || says_nothing(program, func.ty(*obj)) {
                            out.values(func, args);
                            out.values(func, &[*obj]);
                        }
                    }
                },
                Some(Op::Construct { callee, args }) => {
                    if is_wide || says_nothing(program, func.ty(*callee)) {
                        out.values(func, args);
                    }
                }
                Some(Op::Operation { name, args }) if matches!(program.strs.get(*name), b"Apply" | b"ConstructWithArray" | b"ConstructWithSpread") => {
                    if is_wide || args.first().is_some_and(|&callee| says_nothing(program, func.ty(callee))) {
                        out.values(func, args);
                    }
                }
                Some(&Op::PropSet { obj, name, value }) => {
                    let fields = fields_named(program, func.ty(obj), name);
                    if fields.is_empty() && views_of(program, func.ty(obj)).is_empty() {
                        out.values(func, &[value]);
                    } else if is_wide && fields.iter().any(|&(layout, field)| says_nothing(program, program.layouts[layout.idx()].fields[field as usize].declared)) {
                        out.values(func, &[value]);
                    }
                }
                Some(&Op::ElemSet { obj, value, .. }) => {
                    if says_nothing(program, func.ty(obj)) {
                        out.values(func, &[value]);
                    }
                }
                Some(&Op::FieldSet { layout, field, value, .. }) => {
                    let into = &program.layouts[layout.idx()];
                    if is_wide && into.kind != LayoutKind::Environment && says_nothing(program, into.fields[field as usize].declared) {
                        out.values(func, &[value]);
                    }
                }
                Some(&Op::GlobalSet(global, value)) => {
                    if is_wide && says_nothing(program, program.globals[global.idx()].declared) {
                        out.values(func, &[value]);
                    }
                }
                _ => {}
            }
        }
        if is_wide && func.has(func_flags::IS_VALUE) {
            for block in &func.blocks {
                if let Some(Term::Return(value)) = &block.term {
                    out.values(func, &[*value]);
                }
            }
        }
    }
    let at_the_doors = out.count();
    out.close();
    (out.is_out, at_the_doors, out.doors)
}

fn tag_of(program: &Program, members: &[LayoutId]) -> Option<StrId> {
    let first = &program.layouts[members.first()?.idx()];
    first.fields.iter().filter(|field| !field.literals.is_empty()).map(|field| field.name).find(|&name| {
        members.iter().all(|member| {
            let made_as = &program.layouts[member.idx()];
            made_as.field(name).is_some_and(|field| !made_as.fields[field as usize].literals.is_empty())
        })
    })
}

pub(super) fn explain(program: &Program) -> Vec<String> {
    let mut lines = Vec::new();
    let (narrow, narrow_at_the_doors, narrow_doors) = outbound(program, false);
    let (wide, wide_at_the_doors, wide_doors) = outbound(program, true);
    let holds = |view: LayoutId, set: &[bool]| set[view.idx()] || program.layouts[view.idx()].members.iter().any(|member| set[member.idx()]);
    let is_view = |layout: &crate::ir::Layout| layout.kind != LayoutKind::Environment;
    let allocated = program.layouts.iter().filter(|layout| is_view(layout) && layout.is_allocated).count();
    let count_of = |set: &[bool]| set.iter().filter(|&&is_in| is_in).count();
    lines.push(format!("boundary: layouts that objects are made as: {allocated}"));
    lines.push(format!("boundary: outbound, narrow: {narrow_doors} doors; {narrow_at_the_doors} layouts at the doors; {} with what they hold", count_of(&narrow)));
    lines.push(format!("boundary: outbound, wide: {wide_doors} doors; {wide_at_the_doors} layouts at the doors; {} with what they hold", count_of(&wide)));
    let mut views = [0usize; 6];
    for (index, layout) in program.layouts.iter().enumerate().filter(|(_, layout)| is_view(layout)) {
        let view = LayoutId::new(index);
        let (by_narrow, by_wide) = (holds(view, &narrow), holds(view, &wide));
        views[0] += 1;
        views[1] += usize::from(layout.admits_foreign);
        views[2] += usize::from(by_narrow);
        views[3] += usize::from(by_narrow && !layout.admits_foreign);
        views[4] += usize::from(by_wide);
        views[5] += usize::from(by_wide && !layout.admits_foreign);
    }
    lines.push(format!("boundary: views: {} in all; inbound: {} admit; outbound, narrow: {} hold a layout that gets out, {} of them do not admit; wide: {}, {}", views[0], views[1], views[2], views[3], views[4], views[5]));
    let mut sites = [0usize; 6];
    for func in &program.funcs {
        for &v in func.blocks.iter().flat_map(|block| &block.ops) {
            let receiver = match func.op(v) {
                Some(&(Op::PropGet { obj, .. } | Op::PropSet { obj, .. } | Op::PropHas { obj, .. } | Op::PropDelete { obj, .. })) => obj,
                Some(&Op::CallMethod { obj, .. }) => obj,
                _ => continue,
            };
            let through = views_of(program, func.ty(receiver));
            if through.is_empty() {
                continue;
            }
            let admits = through.iter().any(|view| program.layouts[view.idx()].admits_foreign);
            let (by_narrow, by_wide) = (through.iter().any(|&view| holds(view, &narrow)), through.iter().any(|&view| holds(view, &wide)));
            sites[0] += 1;
            sites[1] += usize::from(admits);
            sites[2] += usize::from(by_narrow);
            sites[3] += usize::from(by_narrow && !admits);
            sites[4] += usize::from(by_wide);
            sites[5] += usize::from(by_wide && !admits);
        }
    }
    lines.push(format!("boundary: sites that go by a name through a view: {} in all; inbound: {} through one that admits; outbound, narrow: {}, {} of them through none that admits; wide: {}, {}", sites[0], sites[1], sites[2], sites[3], sites[4], sites[5]));
    let mut tagged = [0usize; 6];
    for index in 0..program.tys.list.len() {
        let through = views_of(program, TyId::new(index));
        let mut members: Vec<LayoutId> = Vec::new();
        for &view in &through {
            for &member in program.layouts[view.idx()].members.iter().chain(std::iter::once(&view)) {
                if program.layouts[member.idx()].is_allocated && !members.contains(&member) {
                    members.push(member);
                }
            }
        }
        if members.len() < 2 || tag_of(program, &members).is_none() {
            continue;
        }
        let admits = through.iter().any(|view| program.layouts[view.idx()].admits_foreign);
        let (by_narrow, by_wide) = (through.iter().any(|&view| holds(view, &narrow)), through.iter().any(|&view| holds(view, &wide)));
        tagged[0] += 1;
        tagged[1] += usize::from(admits);
        tagged[2] += usize::from(by_narrow);
        tagged[3] += usize::from(by_narrow && !admits);
        tagged[4] += usize::from(by_wide);
        tagged[5] += usize::from(by_wide && !admits);
    }
    lines.push(format!("boundary: types of two members or more that share a tag: {} in all; inbound: {} with a view that admits; outbound, narrow: {}, {} of them with none that admits; wide: {}, {}", tagged[0], tagged[1], tagged[2], tagged[3], tagged[4], tagged[5]));
    lines
}
