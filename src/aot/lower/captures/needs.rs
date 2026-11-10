use bun_sema::bind::ScopeId;
use bun_sema::util::SharedSort;
use smallvec::SmallVec;

use super::{Capture, CaptureInput, CaptureList, CapturePlan, CapturedBinding};
use crate::lower::scope::{BindingRef, Initialization, WalkedFunction, WalkedFunctionId};

type OwnedEnvironment = (ScopeId, WalkedFunctionId);

const MOST_CAPTURES_HANDED_OVER_AT_A_CALL: usize = 4;

#[derive(Default, Clone)]
struct Needs {
    bindings: SmallVec<[BindingRef; 4]>,
    environments: SmallVec<[OwnedEnvironment; 2]>,
    is_over_limit: bool,
    is_settled: bool,
    scopes_supplied: SmallVec<[OwnedEnvironment; 1]>,
}

struct ListedBindings<'x> {
    bindings: &'x [CapturedBinding],
    places_of_symbols: Vec<u32>,
}

struct CaptureProblem<'x> {
    input: &'x CaptureInput<'x>,
    listed: &'x ListedBindings<'x>,
    suppliers: &'x [SmallVec<[WalkedFunctionId; 1]>],
    is_called_by_name: &'x [bool],
}

struct SuppliedCaptures {
    values: SmallVec<[(BindingRef, WalkedFunctionId); 4]>,
    environments: SmallVec<[OwnedEnvironment; 4]>,
}

impl<'x> ListedBindings<'x> {
    fn new(bindings: &'x [CapturedBinding]) -> ListedBindings<'x> {
        let number_of_symbols =
            bindings.partition_point(|captured| matches!(captured.binding, BindingRef::Symbol(_)));
        let symbols = &bindings[..number_of_symbols];
        let number_of_places = match symbols.last().map(|captured| captured.binding) {
            Some(BindingRef::Symbol(symbol)) => symbol.idx() + 1,
            Some(BindingRef::Slot(..)) | None => 0,
        };
        let mut places_of_symbols = vec![u32::MAX; number_of_places];
        for (place, captured) in (0..).zip(symbols) {
            if let BindingRef::Symbol(symbol) = captured.binding {
                places_of_symbols[symbol.idx()] = place;
            }
        }
        ListedBindings {
            bindings,
            places_of_symbols,
        }
    }

    #[inline]
    fn find(&self, binding: BindingRef) -> &'x CapturedBinding {
        let place = match binding {
            BindingRef::Symbol(symbol) => self.places_of_symbols.get(symbol.idx()).copied(),
            BindingRef::Slot(..) => None,
        };
        match place.and_then(|place| self.bindings.get(place as usize)) {
            Some(captured) => captured,
            None => find_binding(self.bindings, binding),
        }
    }
}

pub(in crate::lower) fn compute_captures(input: &CaptureInput<'_>) -> CapturePlan {
    debug_assert!(input.bindings.is_sorted_by_key(|captured| captured.binding));
    debug_assert!(input.entry_captures.is_sorted());
    let count = input.functions.len();
    let mut suppliers: Vec<SmallVec<[WalkedFunctionId; 1]>> = Vec::with_capacity(count);
    for function in input.functions {
        let mut creators = SmallVec::new();
        if let Some(creator) = function.creator {
            creators.push(creator);
        }
        suppliers.push(creators);
    }
    for &(user, function) in input.references {
        insert_sorted(&mut suppliers[function.index()], user);
    }
    let mut is_called_by_name = vec![false; count];
    for &(_, function) in input.references {
        is_called_by_name[function.index()] =
            input.functions[function.index()].hoisted_to.is_some();
    }
    let listed = ListedBindings::new(input.bindings);
    let problem = CaptureProblem {
        input,
        listed: &listed,
        suppliers: &suppliers,
        is_called_by_name: &is_called_by_name,
    };
    let plan = plan_captures(&problem, &[]);
    match find_bindings_read_in_held_scopes(input, &listed, &plan) {
        Some(read_in_scopes) => plan_captures(&problem, &read_in_scopes),
        None => plan,
    }
}

fn find_bindings_read_in_held_scopes(
    input: &CaptureInput<'_>,
    listed: &ListedBindings<'_>,
    plan: &CapturePlan,
) -> Option<Vec<BindingRef>> {
    let mut copies_field = false;
    let mut sibling_functions = Vec::new();
    let mut copied_beside_scope = Vec::new();
    let lists = input.functions.iter().zip(&plan.captures);
    for (function, list) in lists.filter(|(function, _)| !function.is_only_called_directly) {
        let number_of_scopes =
            list.partition_point(|capture| matches!(capture, Capture::Environment(_)));
        let (scopes, values) = list.split_at(number_of_scopes);
        if scopes.is_empty() {
            continue;
        }
        for &capture in values {
            let Capture::Value(binding) = capture else {
                continue;
            };
            let captured = listed.find(binding);
            if !scopes.contains(&Capture::Environment(captured.scope)) {
                continue;
            }
            if plan.fields.binary_search(&binding).is_ok() {
                copies_field = true;
            } else if captured.initialization == Some(Initialization::WITH_HOISTED_FUNCTIONS) {
                sibling_functions.push(binding);
            } else if function.is_laid_in_literal && scopes.len() == 1 {
                copied_beside_scope.push(binding);
            }
        }
    }
    if !copied_beside_scope.is_empty() {
        copied_beside_scope.sort_unstable();
        copied_beside_scope.dedup();
        let mut copied_alone = Vec::new();
        for list in &plan.captures {
            for &capture in list.iter() {
                if let Capture::Value(binding) = capture
                    && copied_beside_scope.binary_search(&binding).is_ok()
                    && !list.contains(&Capture::Environment(listed.find(binding).scope))
                {
                    copied_alone.push(binding);
                }
            }
        }
        copied_beside_scope.retain(|binding| !copied_alone.contains(binding));
        sibling_functions.append(&mut copied_beside_scope);
    }
    if !copies_field && sibling_functions.is_empty() {
        return None;
    }
    sibling_functions.extend_from_slice(&plan.fields);
    sibling_functions.sort_unstable();
    sibling_functions.dedup();
    Some(sibling_functions)
}

fn plan_captures(problem: &CaptureProblem<'_>, fields_of_scopes: &[BindingRef]) -> CapturePlan {
    let &CaptureProblem {
        input,
        listed,
        suppliers,
        is_called_by_name,
    } = problem;
    let count = input.functions.len();
    let mut needs: Vec<Needs> = Vec::new();
    needs.resize_with(count, Needs::default);
    for &(user, binding) in input.uses {
        if listed.find(binding).owner != user {
            insert_sorted(&mut needs[user.index()].bindings, binding);
        }
    }
    let mut captures: Vec<CaptureList> = Vec::new();
    captures.resize_with(count, CaptureList::new);
    let mut queue: Vec<WalkedFunctionId> = (0..count as u32).map(WalkedFunctionId).collect();
    let mut is_queued = vec![true; count];
    while let Some(function) = queue.pop() {
        is_queued[function.index()] = false;
        let own_needs = &mut needs[function.index()];
        if own_needs.is_settled {
            continue;
        }
        if own_needs.bindings.is_empty()
            && own_needs.environments.is_empty()
            && input.entry_captures.is_empty()
        {
            continue;
        }
        let mut derived = list_captures(problem, function, own_needs, fields_of_scopes);
        let limit = match is_called_by_name[function.index()] {
            true => input.max_captures.min(MOST_CAPTURES_HANDED_OVER_AT_A_CALL),
            false => input.max_captures,
        };
        if !own_needs.is_over_limit && derived.len() > limit {
            own_needs.is_over_limit = true;
            derived = list_captures(problem, function, own_needs, fields_of_scopes);
        }
        let supplied = collect_supplied_captures(listed, own_needs, &derived);
        if own_needs.is_over_limit {
            debug_assert!(
                supplied.values.is_empty(),
                "over the limit everything is supplied as a scope"
            );
            own_needs.scopes_supplied = SmallVec::from_slice(&supplied.environments);
            own_needs.is_settled = true;
        }
        captures[function.index()] = derived;
        for &supplier in suppliers[function.index()].iter() {
            let supplier_needs = &mut needs[supplier.index()];
            let has_grown = add_supplier_needs(listed, supplier_needs, supplier, &supplied);
            if has_grown && !is_queued[supplier.index()] {
                is_queued[supplier.index()] = true;
                queue.push(supplier);
            }
        }
    }
    let mut fields = Vec::new();
    for (function_needs, list) in needs.iter().zip(&captures) {
        for &binding in function_needs.bindings.iter() {
            if !is_copied(list, binding) {
                fields.push(binding);
            }
        }
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
    if list.last().is_none_or(|last| *last < item) {
        list.push(item);
        return true;
    }
    match list.binary_search(&item) {
        Ok(_) => false,
        Err(index) => {
            list.insert(index, item);
            true
        }
    }
}

#[inline(never)]
fn find_binding(bindings: &[CapturedBinding], binding: BindingRef) -> &CapturedBinding {
    let index = bindings.binary_search_by_key(&binding, |captured| captured.binding);
    &bindings[index.expect("every used binding is listed")]
}

fn is_copied(captures: &[Capture], binding: BindingRef) -> bool {
    !captures.is_empty() && captures.binary_search(&Capture::Value(binding)).is_ok()
}

fn list_captures(
    problem: &CaptureProblem<'_>,
    function: WalkedFunctionId,
    needs: &Needs,
    fields_of_scopes: &[BindingRef],
) -> CaptureList {
    let (input, listed) = (problem.input, problem.listed);
    let mut captures = CaptureList::new();
    for &(scope, _) in needs.environments.iter() {
        captures.push(Capture::Environment(scope));
    }
    let mut copied: SmallVec<[(BindingRef, ScopeId); 4]> = SmallVec::new();
    for &binding in needs.bindings.iter() {
        let captured = listed.find(binding);
        let is_copied = !needs.is_over_limit
            && captured.is_immutable
            && is_initialized_before(input.functions, captured, function, u32::MAX);
        match is_copied {
            true => copied.push((binding, captured.scope)),
            false => captures.push(Capture::Environment(captured.scope)),
        }
    }
    let is_made_as_closure = !input.functions[function.index()].is_only_called_directly;
    let number_of_scopes = captures.len();
    for &(binding, scope) in copied.iter() {
        let is_read_in_scope = is_made_as_closure
            && !fields_of_scopes.is_empty()
            && fields_of_scopes.binary_search(&binding).is_ok()
            && captures[..number_of_scopes].contains(&Capture::Environment(scope));
        if !is_read_in_scope {
            captures.push(Capture::Value(binding));
        }
    }
    let entries = input.entry_captures;
    if !entries.is_empty() {
        let first = entries.partition_point(|entry| entry.0 < function);
        let own = entries[first..].iter();
        for &(_, binding) in own.take_while(|entry| entry.0 == function) {
            captures.push(Capture::Value(binding));
        }
    }
    if captures.len() > 1 {
        captures.shared_sort_unstable();
        captures.dedup();
    }
    captures
}

fn collect_supplied_captures(
    listed: &ListedBindings<'_>,
    needs: &Needs,
    captures: &[Capture],
) -> SuppliedCaptures {
    let mut supplied = SuppliedCaptures {
        values: SmallVec::new(),
        environments: SmallVec::new(),
    };
    for &environment in needs.environments.iter() {
        supplied.environments.push(environment);
    }
    for &binding in needs.bindings.iter() {
        let captured = listed.find(binding);
        if is_copied(captures, binding) {
            supplied.values.push((binding, captured.owner));
        } else {
            insert_sorted(&mut supplied.environments, (captured.scope, captured.owner));
        }
    }
    supplied
}

fn add_supplier_needs(
    listed: &ListedBindings<'_>,
    needs: &mut Needs,
    supplier: WalkedFunctionId,
    supplied: &SuppliedCaptures,
) -> bool {
    let mut has_grown = false;
    for &(binding, owner) in supplied.values.iter() {
        if owner != supplier && insert_sorted(&mut needs.bindings, binding) {
            has_grown = true;
            if needs.is_settled {
                let scope = (listed.find(binding).scope, owner);
                needs.is_settled = needs.scopes_supplied.binary_search(&scope).is_ok();
            }
        }
    }
    for &scope in supplied.environments.iter() {
        if scope.1 != supplier && insert_sorted(&mut needs.environments, scope) {
            has_grown = true;
            needs.is_settled &= needs.scopes_supplied.binary_search(&scope).is_ok();
        }
    }
    has_grown
}
