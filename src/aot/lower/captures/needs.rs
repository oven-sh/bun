use bun_sema::bind::ScopeId;
use bun_sema::util::SharedSort;
use smallvec::SmallVec;

use super::{Capture, CaptureInput, CaptureList, CapturePlan, CapturedBinding};
use crate::lower::scope::{BindingRef, WalkedFunction, WalkedFunctionId};

type OwnedEnvironment = (ScopeId, WalkedFunctionId);

// What a call hands over in registers beside the arguments.
const MOST_CAPTURES_HANDED_OVER_AT_A_CALL: usize = 4;

#[derive(Default, Clone)]
struct Needs {
    bindings: SmallVec<[BindingRef; 4]>,
    environments: SmallVec<[OwnedEnvironment; 2]>,
    is_over_limit: bool,
}

struct CaptureProblem<'x> {
    input: &'x CaptureInput<'x>,
    suppliers: &'x [SmallVec<[WalkedFunctionId; 1]>],
    is_called_by_name: &'x [bool],
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
    let mut is_called_by_name = vec![false; count];
    for &(_, function) in input.references {
        is_called_by_name[function.index()] =
            input.functions[function.index()].hoisted_to.is_some();
    }
    let problem = CaptureProblem {
        input,
        suppliers: &suppliers,
        is_called_by_name: &is_called_by_name,
    };
    let plan = plan_captures(&problem, &[]);
    match holds_scope_beside_copy_of_its_field(input, &plan) {
        true => plan_captures(&problem, &plan.fields),
        false => plan,
    }
}

fn holds_scope_beside_copy_of_its_field(input: &CaptureInput<'_>, plan: &CapturePlan) -> bool {
    let lists = input.functions.iter().zip(&plan.captures);
    let mut lists = lists.filter(|(function, _)| !function.is_made_late);
    lists.any(|(_, list)| {
        let number_of_scopes =
            list.partition_point(|capture| matches!(capture, Capture::Environment(_)));
        let (scopes, values) = list.split_at(number_of_scopes);
        !scopes.is_empty()
            && values.iter().any(|&capture| match capture {
                Capture::Value(binding) if plan.fields.binary_search(&binding).is_ok() => {
                    scopes.contains(&Capture::Environment(find_binding(input, binding).scope))
                }
                _ => false,
            })
    })
}

fn plan_captures(problem: &CaptureProblem<'_>, fields_of_scopes: &[BindingRef]) -> CapturePlan {
    let &CaptureProblem {
        input,
        suppliers,
        is_called_by_name,
    } = problem;
    let count = input.functions.len();
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
        let mut derived = list_captures(input, function, own_needs, fields_of_scopes);
        let limit = match is_called_by_name[function.index()] {
            true => input.max_captures.min(MOST_CAPTURES_HANDED_OVER_AT_A_CALL),
            false => input.max_captures,
        };
        if !own_needs.is_over_limit && derived.len() > limit {
            own_needs.is_over_limit = true;
            derived = list_captures(input, function, own_needs, fields_of_scopes);
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
    for (function_needs, list) in needs.iter().zip(&captures) {
        let bindings = function_needs.bindings.iter().copied();
        fields.extend(bindings.filter(|&binding| !is_copied(list, binding)));
    }
    fields.sort_unstable();
    fields.dedup();
    CapturePlan { captures, fields }
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
    // Whatever stands below a function that is made late is made when that function has started, wherever its text stands.
    let mut below_owner = function;
    while let Some(creator) = functions[below_owner.index()].creator
        && creator != binding.owner
    {
        below_owner = creator;
    }
    let started = &functions[below_owner.index()];
    if started.is_made_late && started.creator == Some(binding.owner) {
        return initialization.precedes_hoisted_functions
            || started.created_at > initialization.time;
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
    fields_of_scopes: &[BindingRef],
) -> CaptureList {
    let environments = needs.environments.iter();
    let environments = environments.map(|&(scope, _)| Capture::Environment(scope));
    let mut captures: CaptureList = environments.collect();
    let mut copied: SmallVec<[(BindingRef, ScopeId); 4]> = SmallVec::new();
    for &binding in &needs.bindings {
        let captured = find_binding(input, binding);
        let is_copied = !needs.is_over_limit
            && captured.is_immutable
            && is_initialized_before(input.functions, captured, function, u32::MAX);
        match is_copied {
            true => copied.push((binding, captured.scope)),
            false => captures.push(Capture::Environment(captured.scope)),
        }
    }
    let is_made_as_closure = !input.functions[function.index()].is_made_late;
    let number_of_scopes = captures.len();
    for (binding, scope) in copied {
        let is_read_in_scope = is_made_as_closure
            && fields_of_scopes.binary_search(&binding).is_ok()
            && captures[..number_of_scopes].contains(&Capture::Environment(scope));
        if !is_read_in_scope {
            captures.push(Capture::Value(binding));
        }
    }
    let entries = input.entry_captures;
    let first = entries.partition_point(|entry| entry.0 < function);
    let own = entries[first..].iter();
    let own = own.take_while(|entry| entry.0 == function);
    captures.extend(own.map(|&(_, binding)| Capture::Value(binding)));
    captures.shared_sort_unstable();
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
