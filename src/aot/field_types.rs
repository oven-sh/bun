//! How the linked program describes the fields of its layouts, for the soundness closure: what the engine compares where a field that is
//! stored through one layout is read through another.

use crate::declared::Part;
use crate::id::{LayoutId, TyId};
use crate::ir::{Def, Op, Program, STATIC_FIELD_IS_ANNOTATED, Why, field_flags};
use bun_sema::check::FieldTypes;
use bun_sema::types::TypeId;

/// `views`: the layouts that a type of the checker stands for.
pub(crate) fn field_types(program: &Program, views: &[(LayoutId, TypeId)]) -> FieldTypes {
    let mut view_of = vec![u32::MAX; program.layouts.len()];
    for (index, view) in views.iter().enumerate() {
        view_of[view.0.idx()] = index as u32;
    }
    let mut together: Vec<Vec<u32>> = Vec::new();
    // By type: its number in `together`.
    let mut union_of = vec![u32::MAX; program.tys.list.len()];
    for (ty, number) in union_of.iter_mut().enumerate() {
        let parts = program.tys.get(TyId::new(ty)).parts.iter().filter_map(|part| if let Part::Class(layout) = part { Some(*layout) } else { None });
        let mut parts: Vec<u32> = parts.filter(|layout| layout.is_some()).map(|layout| view_of[layout.idx()]).filter(|&view| view != u32::MAX).collect();
        if parts.len() > 1 {
            parts.sort_unstable();
            *number = together.len() as u32;
            together.push(parts);
        }
    }
    let mut views_in: Vec<Vec<u32>> = Vec::with_capacity(program.tys.list.len());
    let mut unions_in: Vec<Vec<u32>> = Vec::with_capacity(program.tys.list.len());
    for ty in 0..program.tys.list.len() {
        let (mut found, mut unions, mut passed, mut pending) = (Vec::new(), Vec::new(), vec![TyId::new(ty)], vec![TyId::new(ty)]);
        while let Some(at) = pending.pop() {
            // What comes before this one has been gone through, all the way down.
            if at.idx() < ty {
                found.extend_from_slice(&views_in[at.idx()]);
                unions.extend_from_slice(&unions_in[at.idx()]);
                continue;
            }
            unions.extend(Some(union_of[at.idx()]).filter(|&number| number != u32::MAX));
            for part in &program.tys.get(at).parts {
                let held: &[TyId] = match part {
                    // A type that is only expected of a value does not keep its layouts in the program.
                    Part::Class(layout) => {
                        found.extend(layout.is_some().then(|| view_of[layout.idx()]).filter(|&view| view != u32::MAX));
                        &[]
                    }
                    Part::Array(elements) => std::slice::from_ref(elements),
                    Part::Global(_, arguments) => arguments,
                };
                for &inner in held.iter().filter(|inner| inner.is_some()) {
                    if !passed.contains(&inner) {
                        passed.push(inner);
                        pending.push(inner);
                    }
                }
            }
        }
        found.sort_unstable();
        found.dedup();
        views_in.push(found);
        unions.sort_unstable();
        unions.dedup();
        unions_in.push(unions);
    }
    let casts = program.funcs.iter().flat_map(|func| &func.values).filter_map(|value| match value.def {
        Def::Op(Op::Coerce { to, why: Why::Cast | Why::Coerce, .. }) if to.is_some() => Some(to.0),
        _ => None,
    });
    let mut copied_to: Vec<u32> = casts.collect();
    copied_to.sort_unstable();
    copied_to.dedup();
    let of_views = (views.iter())
        .map(|view| {
            let fields = program.layouts[view.0.idx()].fields.iter().filter(|field| field.name.is_some() && field.declared.is_some() && field.flags & field_flags::NEVER_STORED == 0);
            let mut fields: Vec<(u32, u32)> = fields.map(|field| (field.name.0, field.declared.0)).collect();
            fields.sort_unstable();
            fields
        })
        .collect();
    let of_static_fields = (program.layouts.iter())
        .flat_map(|layout| layout.static_fields.iter().map(move |field| (layout, (field.1 & !STATIC_FIELD_IS_ANNOTATED) as usize)))
        .filter_map(|(layout, variable)| match layout.environment.is_some() {
            true => program.layouts[layout.environment.idx()].fields.get(variable).map(|field| field.declared),
            false => program.globals.get(variable).map(|global| global.declared),
        })
        .filter(|declared| declared.is_some())
        .map(|declared| declared.0)
        .collect();
    FieldTypes { of_views, of_static_fields, views_in, together, unions_in, copied_to }
}
