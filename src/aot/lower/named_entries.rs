use core::mem::{replace, take};
use std::sync::Arc;

use rustc_hash::FxHashMap;

use super::fragment::Fragment;
use crate::ir::generated::{Function, FunctionReferenceKind};
use crate::ir::{FunctionId, Id, IdMap, LayoutId, PropertyKeyId, Reference, TypeId, TypeTable};

#[cfg(test)]
mod tests;

struct NamedEntries {
    strings: Vec<bool>,
    property_keys: Vec<bool>,
    types: Vec<bool>,
    type_sites: Vec<bool>,
    layouts: Vec<bool>,
    variables: Vec<bool>,
    functions: Vec<bool>,
    // The entries that name others and have not been read yet.
    unread: Vec<Reference>,
}

impl NamedEntries {
    fn new(fragment: &Fragment) -> NamedEntries {
        let mut types = vec![false; fragment.types.len()];
        types[..TypeTable::WELL_KNOWN_COUNT].fill(true);
        NamedEntries {
            strings: vec![false; fragment.strings.len()],
            property_keys: vec![false; fragment.property_keys.len()],
            types,
            type_sites: vec![false; fragment.type_sites.len()],
            layouts: vec![false; fragment.layout_keys.len()],
            variables: vec![false; fragment.variable_keys.len()],
            functions: vec![false; fragment.function_keys.len()],
            unread: Vec::new(),
        }
    }

    fn add(&mut self, reference: Reference) {
        let (is_named, names_others) = match reference {
            Reference::String(id) => (&mut self.strings[id.index()], false),
            Reference::PropertyKey(id) => (&mut self.property_keys[id.index()], true),
            Reference::Type(id) => (&mut self.types[id.index()], true),
            Reference::TypeSite(id) => (&mut self.type_sites[id.index()], true),
            Reference::Layout(id) => (&mut self.layouts[id.index()], false),
            Reference::Variable(id) => (&mut self.variables[id.index()], false),
            Reference::Function(id, _) => (&mut self.functions[id.index()], false),
            Reference::ExpectedResult(_)
            | Reference::Module(..)
            | Reference::ModuleFailure(_)
            | Reference::EvalScope(_)
            | Reference::Data(_)
            | Reference::Builtin(_) => return,
        };
        if !replace(is_named, true) && names_others {
            self.unread.push(reference);
        }
    }

    fn add_layout(&mut self, layout: LayoutId) {
        self.add(Reference::Layout(layout));
    }

    fn add_function(&mut self, function: FunctionId) {
        self.add(Reference::Function(
            function,
            FunctionReferenceKind::Dispatch,
        ));
    }

    fn add_records(&mut self, fragment: &Fragment) {
        let mut add = |reference: Reference| self.add(reference);
        for (id, function) in &fragment.functions {
            add(Reference::Function(*id, FunctionReferenceKind::Dispatch));
            function.for_each_reference(&mut add);
        }
        for (id, layout) in &fragment.layouts {
            add(Reference::Layout(*id));
            layout.for_each_reference(&mut add);
        }
        for (id, variable) in &fragment.variables {
            add(Reference::Variable(*id));
            variable.for_each_reference(&mut add);
        }
        for record in &fragment.expected_results {
            record.for_each_reference(&mut add);
        }
        for record in &fragment.eval_scopes {
            record.for_each_reference(&mut add);
        }
        for record in &fragment.data {
            record.for_each_reference(&mut add);
        }
        for &key in &fragment.written_keys {
            add(Reference::PropertyKey(key));
        }
        for &(source, target) in &fragment.family_facts.conversions {
            add(Reference::Type(source));
            add(Reference::Type(target));
        }
        let facts = &fragment.family_facts;
        let edges = fragment
            .supertype_edges
            .iter()
            .flat_map(|&(layout, supertype)| [layout, supertype]);
        let layouts = edges.chain(fragment.allocated_layouts.iter().copied());
        for layout in layouts.chain(facts.layouts_with_members_without_layout.iter().copied()) {
            self.add_layout(layout);
        }
        let edges = fragment
            .function_type_edges
            .iter()
            .flat_map(|&(source, target)| [source, target]);
        let functions = edges.chain(fragment.builtin_members.iter().map(|member| member.0));
        let functions = functions.chain(
            fragment
                .runtime_functions
                .iter()
                .map(|entry| entry.function),
        );
        for function in functions.chain(fragment.module.body) {
            self.add_function(function);
        }
    }

    fn add_what_entries_name(&mut self, fragment: &Fragment) {
        while let Some(reference) = self.unread.pop() {
            let mut add = |part: Reference| self.add(part);
            match reference {
                Reference::PropertyKey(id) => {
                    fragment.property_keys.get(id).for_each_reference(&mut add)
                }
                Reference::Type(id) => fragment.types.get(id).for_each_reference(&mut add),
                Reference::TypeSite(id) => {
                    fragment.type_sites[id.index()].for_each_reference(&mut add)
                }
                _ => unreachable!("the others name nothing"),
            }
        }
    }

    fn has_all(&self) -> bool {
        let lists = [
            &self.strings,
            &self.property_keys,
            &self.types,
            &self.type_sites,
            &self.layouts,
            &self.variables,
            &self.functions,
        ];
        lists
            .into_iter()
            .all(|list| list.iter().all(|&is_named| is_named))
    }
}

// The entries that stay keep their order.
fn number<I: Id>(is_named: &[bool]) -> Vec<Option<I>> {
    let mut next_ids = (0..).map(I::new);
    is_named
        .iter()
        .map(|&is_named| is_named.then(|| next_ids.next()).flatten())
        .collect()
}

fn keep_all<I: Id>(count: usize) -> Vec<Option<I>> {
    (0..count).map(|index| Some(I::new(index))).collect()
}

fn keep_named<T>(list: &mut Vec<T>, is_named: &[bool]) {
    let mut is_named = is_named.iter();
    list.retain(|_| *is_named.next().expect("a mark for each entry"));
}

fn renumber<I: Id>(id: &mut I, ids: &[Option<I>]) {
    *id = ids[id.index()].expect("what a record names stays");
}

/// Mapping a type brings what the type leads to into the tables of the file, and most of that no record of the file names in the end.
pub(super) fn drop_unnamed_entries(fragment: &mut Fragment) {
    let mut named = NamedEntries::new(fragment);
    named.add_records(fragment);
    named.add_what_entries_name(fragment);
    if named.has_all() {
        return;
    }
    let strings = number(&named.strings);
    let property_keys = number(&named.property_keys);
    let types = number(&named.types);
    let type_sites = number(&named.type_sites);
    let layouts = number(&named.layouts);
    let variables = number(&named.variables);
    let functions = number(&named.functions);
    let expected_results = keep_all(fragment.expected_results.len());
    let modules = keep_all(fragment.module_keys.len());
    let module_failures = keep_all(fragment.module_failure_keys.len());
    let eval_scopes = keep_all(fragment.eval_scopes.len());
    let data = keep_all(fragment.data.len());
    let map = IdMap {
        strings: &strings,
        property_keys: &property_keys,
        types: &types,
        type_sites: &type_sites,
        expected_results: &expected_results,
        layouts: &layouts,
        variables: &variables,
        modules: &modules,
        module_failures: &module_failures,
        eval_scopes: &eval_scopes,
        functions: &functions,
        data: &data,
    };

    let all_strings = take(&mut fragment.strings);
    for id in all_strings.ids().filter(|id| named.strings[id.index()]) {
        fragment.strings.intern_from(&all_strings, id);
    }
    let all_keys = take(&mut fragment.property_keys);
    let key_ids = (0..all_keys.len()).map(PropertyKeyId::new);
    for id in key_ids.filter(|id| named.property_keys[id.index()]) {
        let mut key = *all_keys.get(id);
        key.remap_ids(&map);
        fragment.property_keys.intern(key);
    }
    let all_types = std::mem::take(&mut fragment.types);
    let own_types = all_types
        .iter()
        .enumerate()
        .skip(TypeTable::WELL_KNOWN_COUNT);
    for (index, ty) in own_types.filter(|&(index, _)| named.types[index]) {
        let mut ty = ty.clone();
        ty.remap_ids(&map);
        let id: TypeId = fragment.types.intern(ty);
        debug_assert_eq!(Some(id), types[index]);
    }
    keep_named(&mut fragment.type_sites, &named.type_sites);
    for site in &mut fragment.type_sites {
        site.remap_ids(&map);
    }
    let layouts_of_code = &named.layouts[..fragment.code_layout_count];
    fragment.code_layout_count = layouts_of_code.iter().filter(|&&is_named| is_named).count();
    keep_named(&mut fragment.layout_keys, &named.layouts);
    keep_named(&mut fragment.variable_keys, &named.variables);
    keep_named(&mut fragment.function_keys, &named.functions);

    // Several keys of a file can have one record.
    let mut renumbered: FxHashMap<*const Function, Arc<Function>> = FxHashMap::default();
    for (id, function) in &mut fragment.functions {
        renumber(id, &functions);
        match Arc::get_mut(function) {
            Some(function) => function.remap_ids(&map),
            None => {
                let copy = renumbered.entry(Arc::as_ptr(function)).or_insert_with(|| {
                    let mut copy = Function::clone(function);
                    copy.remap_ids(&map);
                    Arc::new(copy)
                });
                *function = Arc::clone(copy);
            }
        }
    }
    for (id, layout) in &mut fragment.layouts {
        renumber(id, &layouts);
        layout.remap_ids(&map);
    }
    for (id, variable) in &mut fragment.variables {
        renumber(id, &variables);
        variable.remap_ids(&map);
    }
    for record in &mut fragment.expected_results {
        record.remap_ids(&map);
    }
    for record in &mut fragment.eval_scopes {
        record.remap_ids(&map);
    }
    for record in &mut fragment.data {
        record.remap_ids(&map);
    }
    for layout in &mut fragment.allocated_layouts {
        renumber(layout, &layouts);
    }
    for key in &mut fragment.written_keys {
        renumber(key, &property_keys);
    }
    for (layout, supertype) in &mut fragment.supertype_edges {
        renumber(layout, &layouts);
        renumber(supertype, &layouts);
    }
    for (source, target) in &mut fragment.function_type_edges {
        renumber(source, &functions);
        renumber(target, &functions);
    }
    for (function_type, _) in &mut fragment.builtin_members {
        renumber(function_type, &functions);
    }
    for entry in &mut fragment.runtime_functions {
        renumber(&mut entry.function, &functions);
    }
    for layout in &mut fragment.family_facts.layouts_with_members_without_layout {
        renumber(layout, &layouts);
    }
    for (source, target) in &mut fragment.family_facts.conversions {
        renumber(source, &types);
        renumber(target, &types);
    }
    if let Some(body) = &mut fragment.module.body {
        renumber(body, &functions);
    }
}
