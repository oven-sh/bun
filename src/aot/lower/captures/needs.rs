use bun_sema::bind::ScopeId;
use smallvec::SmallVec;

use super::{Capture, CaptureInput, CaptureList, CapturePlan, CapturedBinding};
use crate::lower::scope::{BindingRef, WalkedFunction, WalkedFunctionId};

type OwnedEnvironment = (ScopeId, WalkedFunctionId);

#[derive(Default, Clone)]
struct Needs {
    bindings: SmallVec<[BindingRef; 4]>,
    environments: SmallVec<[OwnedEnvironment; 2]>,
    is_over_limit: bool,
}

struct SuppliedCaptures {
    values: SmallVec<[(BindingRef, WalkedFunctionId); 4]>,
    environments: SmallVec<[OwnedEnvironment; 4]>,
}

pub(in crate::lower) fn compute_captures(input: &CaptureInput<'_>) -> CapturePlan {
    debug_assert!(input.bindings.is_sorted_by_key(|captured| captured.binding));
    debug_assert!(input.entry_captures.is_sorted());
    let count = input.functions.len();
    let creators = input.functions.iter().map(|function| function.creator);
    let suppliers = creators.map(|creator| creator.into_iter().collect());
    let mut suppliers: Vec<SmallVec<[WalkedFunctionId; 1]>> = suppliers.collect();
    for &(user, function) in input.references {
        insert_sorted(&mut suppliers[function.index()], user);
    }
    let mut needs = vec![Needs::default(); count];
    for &(user, binding) in input.uses {
        if find_binding(input, binding).owner != user {
            insert_sorted(&mut needs[user.index()].bindings, binding);
        }
    }
    let mut captures = vec![CaptureList::new(); count];
    let mut queue: Vec<WalkedFunctionId> = (0..count as u32).map(WalkedFunctionId).collect();
    let mut is_queued = vec![true; count];
    while let Some(function) = queue.pop() {
        is_queued[function.index()] = false;
        let own_needs = &mut needs[function.index()];
        let mut derived = list_captures(input, function, own_needs);
        if !own_needs.is_over_limit && derived.len() > input.max_captures {
            own_needs.is_over_limit = true;
            derived = list_captures(input, function, own_needs);
        }
        let supplied = collect_supplied_captures(input, own_needs, &derived);
        captures[function.index()] = derived;
        for &supplier in &suppliers[function.index()] {
            let has_grown = add_supplier_needs(&mut needs[supplier.index()], supplier, &supplied);
            if has_grown && !is_queued[supplier.index()] {
                is_queued[supplier.index()] = true;
                queue.push(supplier);
            }
        }
    }
    let mut fields = Vec::new();
    let mut functions_over_limit = Vec::new();
    for (index, (function_needs, list)) in needs.iter().zip(&captures).enumerate() {
        let bindings = function_needs.bindings.iter().copied();
        fields.extend(bindings.filter(|&binding| !is_copied(list, binding)));
        if function_needs.is_over_limit {
            functions_over_limit.push(WalkedFunctionId(index as u32));
        }
    }
    fields.sort_unstable();
    fields.dedup();
    CapturePlan {
        captures,
        fields,
        functions_over_limit,
    }
}

pub(in crate::lower) fn is_initialized_before(
    functions: &[WalkedFunction],
    binding: &CapturedBinding,
    function: WalkedFunctionId,
    time: u32,
) -> bool {
    let Some(initialization) = binding.initialization else {
        return false;
    };
    if time <= initialization.time {
        return false;
    }
    let mut current = function;
    while current != binding.owner {
        let walked = &functions[current.index()];
        if walked.created_at <= initialization.time {
            return false;
        }
        let is_created_by_owner = walked.creator == Some(binding.owner);
        let is_hoisted_in_owner = walked.hoisted_to.is_some() && is_created_by_owner;
        if is_hoisted_in_owner && !initialization.precedes_hoisted_functions {
            return false;
        }
        let Some(creator) = walked.creator else {
            return false;
        };
        debug_assert!(
            creator < current,
            "a creator precedes the functions it creates"
        );
        current = creator;
    }
    true
}

fn insert_sorted<T: Ord + Copy, A: smallvec::Array<Item = T>>(
    list: &mut SmallVec<A>,
    item: T,
) -> bool {
    match list.binary_search(&item) {
        Ok(_) => false,
        Err(index) => {
            list.insert(index, item);
            true
        }
    }
}

fn find_binding<'x>(input: &CaptureInput<'x>, binding: BindingRef) -> &'x CapturedBinding {
    let bindings = input.bindings;
    let index = bindings.binary_search_by_key(&binding, |captured| captured.binding);
    &bindings[index.expect("every used binding is listed")]
}

fn is_copied(captures: &[Capture], binding: BindingRef) -> bool {
    captures.binary_search(&Capture::Value(binding)).is_ok()
}

fn list_captures(
    input: &CaptureInput<'_>,
    function: WalkedFunctionId,
    needs: &Needs,
) -> CaptureList {
    let environments = needs.environments.iter();
    let environments = environments.map(|&(scope, _)| Capture::Environment(scope));
    let mut captures: CaptureList = environments.collect();
    for &binding in &needs.bindings {
        let captured = find_binding(input, binding);
        if !needs.is_over_limit
            && captured.is_immutable
            && is_initialized_before(input.functions, captured, function, u32::MAX)
        {
            captures.push(Capture::Value(binding));
        } else {
            captures.push(Capture::Environment(captured.scope));
        }
    }
    let entries = input.entry_captures;
    let first = entries.partition_point(|entry| entry.0 < function);
    let own = entries[first..].iter();
    let own = own.take_while(|entry| entry.0 == function);
    captures.extend(own.map(|&(_, binding)| Capture::Value(binding)));
    captures.sort_unstable();
    captures.dedup();
    captures
}

fn collect_supplied_captures(
    input: &CaptureInput<'_>,
    needs: &Needs,
    captures: &[Capture],
) -> SuppliedCaptures {
    let mut supplied = SuppliedCaptures {
        values: SmallVec::new(),
        environments: SmallVec::from_slice(&needs.environments),
    };
    for &binding in &needs.bindings {
        let captured = find_binding(input, binding);
        if is_copied(captures, binding) {
            supplied.values.push((binding, captured.owner));
        } else {
            insert_sorted(&mut supplied.environments, (captured.scope, captured.owner));
        }
    }
    supplied
}

fn add_supplier_needs(
    needs: &mut Needs,
    supplier: WalkedFunctionId,
    supplied: &SuppliedCaptures,
) -> bool {
    let mut has_grown = false;
    for &(binding, owner) in &supplied.values {
        if owner != supplier {
            has_grown |= insert_sorted(&mut needs.bindings, binding);
        }
    }
    for &(scope, owner) in &supplied.environments {
        if owner != supplier {
            has_grown |= insert_sorted(&mut needs.environments, (scope, owner));
        }
    }
    has_grown
}
