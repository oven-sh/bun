use bun_sema::bind::{ScopeId, SymbolId};
use bun_sema::check::aot::FunctionRef;
use bun_sema::hir::FnId;
use bun_sema::program::FileId;

use super::{
    Capture, CaptureInput, CapturePlan, CapturedBinding, compute_captures, is_initialized_before,
    max_captures,
};
use crate::compile::testing::{
    default_settings, lower_and_link_program, lower_program_with_limits,
};
use crate::ir::FunctionKey;
use crate::ir::generated::LayoutKind;
use crate::lower::scope::{
    BindingRef, Initialization, ScopeSlot, WalkedFunction, WalkedFunctionId,
};
use crate::statistics::LimitValues;

const ROOT: WalkedFunctionId = WalkedFunctionId::MODULE_BODY;
const ROOT_SCOPE: ScopeId = ScopeId(0);
const ENVIRONMENT: Capture = Capture::Environment(ROOT_SCOPE);
const NO_LIMIT: usize = usize::MAX;

struct Fixture {
    functions: Vec<WalkedFunction>,
    bindings: Vec<CapturedBinding>,
    uses: Vec<(WalkedFunctionId, BindingRef)>,
    references: Vec<(WalkedFunctionId, WalkedFunctionId)>,
    entry_captures: Vec<(WalkedFunctionId, BindingRef)>,
}

fn initialized_at(time: u32) -> Option<Initialization> {
    Some(Initialization {
        time,
        precedes_hoisted_functions: false,
    })
}

fn captures_of(plan: &CapturePlan, function: WalkedFunctionId) -> &[Capture] {
    &plan.captures[function.index()]
}

impl Fixture {
    fn new() -> Fixture {
        Fixture {
            functions: vec![WalkedFunction {
                key: FunctionKey::ModuleBody(FileId(0)),
                creator: None,
                created_at: 0,
                hoisted_to: None,
            }],
            bindings: Vec::new(),
            uses: Vec::new(),
            references: Vec::new(),
            entry_captures: Vec::new(),
        }
    }

    fn add_function(&mut self, creator: WalkedFunctionId, created_at: u32) -> WalkedFunctionId {
        let index = self.functions.len() as u32;
        let (file, function) = (FileId(0), FnId(index));
        self.functions.push(WalkedFunction {
            key: FunctionKey::Source(FunctionRef { file, function }),
            creator: Some(creator),
            created_at,
            hoisted_to: None,
        });
        WalkedFunctionId(index)
    }

    fn add_hoisted_function(
        &mut self,
        creator: WalkedFunctionId,
        created_at: u32,
        scope: ScopeId,
    ) -> WalkedFunctionId {
        let function = self.add_function(creator, created_at);
        self.functions[function.index()].hoisted_to = Some(scope);
        function
    }

    fn add_binding(&mut self, captured: CapturedBinding) -> BindingRef {
        self.bindings.push(captured);
        captured.binding
    }

    fn add_symbol(
        &mut self,
        owner: WalkedFunctionId,
        scope: ScopeId,
        is_immutable: bool,
        initialization: Option<Initialization>,
    ) -> BindingRef {
        let symbol = SymbolId(self.bindings.len() as u32);
        self.add_binding(CapturedBinding {
            binding: BindingRef::Symbol(symbol),
            scope,
            owner,
            is_immutable,
            initialization,
        })
    }

    fn add_root_constant(&mut self, time: u32) -> BindingRef {
        self.add_symbol(ROOT, ROOT_SCOPE, true, initialized_at(time))
    }

    fn add_root_variable(&mut self, time: u32) -> BindingRef {
        self.add_symbol(ROOT, ROOT_SCOPE, false, initialized_at(time))
    }

    fn add_home_object(&mut self, owner: WalkedFunctionId, scope: ScopeId) -> BindingRef {
        let binding = self.add_binding(CapturedBinding {
            binding: BindingRef::Slot(scope, ScopeSlot::HomeObject),
            scope,
            owner,
            is_immutable: true,
            initialization: Some(Initialization::AT_SCOPE_ENTRY),
        });
        self.uses.push((owner, binding));
        self.entry_captures.push((owner, binding));
        binding
    }

    fn find_binding(&self, binding: BindingRef) -> &CapturedBinding {
        let mut bindings = self.bindings.iter();
        let found = bindings.find(|captured| captured.binding == binding);
        found.expect("the fixture declares the binding")
    }

    fn is_initialized_before(
        &self,
        binding: BindingRef,
        function: WalkedFunctionId,
        time: u32,
    ) -> bool {
        is_initialized_before(&self.functions, self.find_binding(binding), function, time)
    }

    fn solve(mut self, max_captures: usize) -> CapturePlan {
        self.bindings
            .sort_unstable_by_key(|captured| captured.binding);
        self.uses.sort_unstable();
        self.references.sort_unstable();
        self.entry_captures.sort_unstable();
        compute_captures(&CaptureInput {
            functions: &self.functions,
            bindings: &self.bindings,
            uses: &self.uses,
            references: &self.references,
            entry_captures: &self.entry_captures,
            max_captures,
        })
    }
}

#[test]
fn owner_captures_nothing() {
    for is_immutable in [true, false] {
        let mut fixture = Fixture::new();
        let binding = fixture.add_symbol(ROOT, ROOT_SCOPE, is_immutable, initialized_at(3));
        fixture.uses.push((ROOT, binding));
        let plan = fixture.solve(NO_LIMIT);
        assert!(captures_of(&plan, ROOT).is_empty());
        assert!(plan.fields.is_empty());
        assert!(plan.functions_over_limit.is_empty());
    }
}

#[test]
fn single_user_copies_what_is_immutable_and_initialized_before_its_creation() {
    let at_entry = Some(Initialization::AT_SCOPE_ENTRY);
    // The time of the user's creation, is the binding immutable, its initialization, is it copied.
    let rows = [
        (5, true, initialized_at(3), true),
        (5, true, initialized_at(7), false),
        (5, true, initialized_at(5), false),
        (0, true, at_entry, false),
        (1, true, at_entry, true),
        (5, false, initialized_at(3), false),
        (5, true, None, false),
    ];
    for row @ (created_at, is_immutable, initialization, is_copied) in rows {
        let mut fixture = Fixture::new();
        let binding = fixture.add_symbol(ROOT, ROOT_SCOPE, is_immutable, initialization);
        let user = fixture.add_function(ROOT, created_at);
        fixture.uses.push((user, binding));
        let plan = fixture.solve(NO_LIMIT);
        let (capture, fields) = match is_copied {
            true => (Capture::Value(binding), vec![]),
            false => (ENVIRONMENT, vec![binding]),
        };
        assert_eq!(captures_of(&plan, user), [capture], "{row:?}");
        assert!(captures_of(&plan, ROOT).is_empty(), "{row:?}");
        assert_eq!(plan.fields, fields, "{row:?}");
    }
}

#[test]
fn decision_is_per_function() {
    let mut fixture = Fixture::new();
    let binding = fixture.add_root_constant(5);
    let early = fixture.add_function(ROOT, 2);
    let late = fixture.add_function(ROOT, 9);
    fixture.uses.push((early, binding));
    fixture.uses.push((late, binding));
    let plan = fixture.solve(NO_LIMIT);
    assert_eq!(captures_of(&plan, early), [ENVIRONMENT]);
    assert_eq!(captures_of(&plan, late), [Capture::Value(binding)]);
    assert_eq!(plan.fields, [binding]);
}

#[test]
fn need_travels_through_creators() {
    for is_immutable in [true, false] {
        let mut fixture = Fixture::new();
        let binding = fixture.add_symbol(ROOT, ROOT_SCOPE, is_immutable, initialized_at(1));
        let outer = fixture.add_function(ROOT, 2);
        let middle = fixture.add_function(outer, 3);
        let inner = fixture.add_function(middle, 4);
        fixture.uses.push((inner, binding));
        let plan = fixture.solve(NO_LIMIT);
        let expected = match is_immutable {
            true => Capture::Value(binding),
            false => ENVIRONMENT,
        };
        for function in [outer, middle, inner] {
            assert_eq!(captures_of(&plan, function), [expected], "{function:?}");
        }
        assert!(captures_of(&plan, ROOT).is_empty());
        assert_eq!(plan.fields.is_empty(), is_immutable);
    }
}

#[test]
fn environment_travels_through_a_creator_that_copies() {
    let mut fixture = Fixture::new();
    let binding = fixture.add_root_constant(5);
    let creator = fixture.add_function(ROOT, 9);
    let created = fixture.add_function(creator, 2);
    fixture.uses.push((creator, binding));
    fixture.uses.push((created, binding));
    let plan = fixture.solve(NO_LIMIT);
    assert_eq!(captures_of(&plan, created), [ENVIRONMENT]);
    assert_eq!(
        captures_of(&plan, creator),
        [ENVIRONMENT, Capture::Value(binding)]
    );
    assert_eq!(plan.fields, [binding]);
}

#[test]
fn hoisted_function_and_what_it_creates_take_environment() {
    let mut fixture = Fixture::new();
    let binding = fixture.add_root_constant(3);
    let hoisted = fixture.add_hoisted_function(ROOT, 6, ROOT_SCOPE);
    let created = fixture.add_function(hoisted, 7);
    fixture.uses.push((hoisted, binding));
    fixture.uses.push((created, binding));
    let plan = fixture.solve(NO_LIMIT);
    assert_eq!(captures_of(&plan, hoisted), [ENVIRONMENT]);
    assert_eq!(captures_of(&plan, created), [ENVIRONMENT]);
    assert_eq!(plan.fields, [binding]);
}

#[test]
fn hoisted_function_takes_environment_of_another_scope_of_its_creator() {
    let mut fixture = Fixture::new();
    let binding = fixture.add_root_constant(3);
    let hoisted = fixture.add_hoisted_function(ROOT, 6, ScopeId(1));
    fixture.uses.push((hoisted, binding));
    let plan = fixture.solve(NO_LIMIT);
    assert_eq!(captures_of(&plan, hoisted), [ENVIRONMENT]);
    assert_eq!(plan.fields, [binding]);
}

#[test]
fn hoisted_function_copies_from_outer_function() {
    let mut fixture = Fixture::new();
    let binding = fixture.add_root_constant(3);
    let creator = fixture.add_function(ROOT, 4);
    let hoisted = fixture.add_hoisted_function(creator, 6, ScopeId(5));
    fixture.uses.push((hoisted, binding));
    let plan = fixture.solve(NO_LIMIT);
    assert_eq!(captures_of(&plan, hoisted), [Capture::Value(binding)]);
    assert_eq!(captures_of(&plan, creator), [Capture::Value(binding)]);
    assert!(plan.fields.is_empty());
}

#[test]
fn parameter_is_copied_by_hoisted_function() {
    for time in [3, Initialization::AT_SCOPE_ENTRY.time] {
        let mut fixture = Fixture::new();
        let initialization = Initialization {
            time,
            precedes_hoisted_functions: true,
        };
        let binding = fixture.add_symbol(ROOT, ROOT_SCOPE, true, Some(initialization));
        let hoisted = fixture.add_hoisted_function(ROOT, 6, ROOT_SCOPE);
        fixture.uses.push((hoisted, binding));
        let plan = fixture.solve(NO_LIMIT);
        assert_eq!(captures_of(&plan, hoisted), [Capture::Value(binding)]);
        assert!(plan.fields.is_empty());
    }
}

#[test]
fn hoisted_function_reads_its_sibling_from_environment() {
    let mut fixture = Fixture::new();
    let with_functions = Some(Initialization::WITH_HOISTED_FUNCTIONS);
    let sibling = fixture.add_symbol(ROOT, ROOT_SCOPE, true, with_functions);
    let hoisted = fixture.add_hoisted_function(ROOT, 2, ROOT_SCOPE);
    let closure = fixture.add_function(ROOT, 3);
    fixture.uses.push((hoisted, sibling));
    fixture.uses.push((closure, sibling));
    let plan = fixture.solve(NO_LIMIT);
    assert_eq!(captures_of(&plan, hoisted), [ENVIRONMENT]);
    assert_eq!(captures_of(&plan, closure), [Capture::Value(sibling)]);
    assert_eq!(plan.fields, [sibling]);
}

#[test]
fn every_function_on_the_chain_is_tested() {
    let mut fixture = Fixture::new();
    let binding = fixture.add_root_constant(5);
    let creator = fixture.add_function(ROOT, 2);
    let inner = fixture.add_function(creator, 9);
    fixture.uses.push((inner, binding));
    let plan = fixture.solve(NO_LIMIT);
    assert_eq!(captures_of(&plan, inner), [ENVIRONMENT]);
    assert_eq!(captures_of(&plan, creator), [ENVIRONMENT]);
    assert_eq!(plan.fields, [binding]);
}

#[test]
fn reference_supplies_captures() {
    for has_reference in [true, false] {
        let mut fixture = Fixture::new();
        let binding = fixture.add_root_constant(2);
        let function = fixture.add_function(ROOT, 4);
        let user = fixture.add_function(function, 6);
        fixture.uses.push((function, binding));
        if has_reference {
            fixture.references.push((user, function));
        }
        let plan = fixture.solve(NO_LIMIT);
        assert_eq!(captures_of(&plan, function), [Capture::Value(binding)]);
        let supplied = captures_of(&plan, user).contains(&Capture::Value(binding));
        assert_eq!(supplied, has_reference);
        assert_eq!(captures_of(&plan, user).len(), usize::from(has_reference));
    }
}

#[test]
fn supplier_that_cannot_copy_takes_environment() {
    let mut fixture = Fixture::new();
    let binding = fixture.add_root_constant(5);
    let user = fixture.add_function(ROOT, 2);
    let function = fixture.add_function(ROOT, 9);
    fixture.uses.push((function, binding));
    fixture.references.push((user, function));
    let plan = fixture.solve(NO_LIMIT);
    assert_eq!(captures_of(&plan, function), [Capture::Value(binding)]);
    assert_eq!(captures_of(&plan, user), [ENVIRONMENT]);
    assert_eq!(plan.fields, [binding]);
}

#[test]
fn reference_cycle_ends() {
    let mut fixture = Fixture::new();
    let first_binding = fixture.add_root_constant(1);
    let second_binding = fixture.add_root_constant(2);
    let first = fixture.add_function(ROOT, 3);
    let second = fixture.add_function(ROOT, 4);
    fixture.uses.push((first, first_binding));
    fixture.uses.push((second, second_binding));
    fixture.references.push((first, second));
    fixture.references.push((second, first));
    let plan = fixture.solve(NO_LIMIT);
    let both = [
        Capture::Value(first_binding),
        Capture::Value(second_binding),
    ];
    assert_eq!(captures_of(&plan, first), both);
    assert_eq!(captures_of(&plan, second), both);
}

#[test]
fn entry_capture_is_not_asked_of_the_creator() {
    let mut fixture = Fixture::new();
    let method = fixture.add_function(ROOT, 3);
    let home_object = fixture.add_home_object(method, ScopeId(1));
    let plan = fixture.solve(NO_LIMIT);
    assert_eq!(captures_of(&plan, method), [Capture::Value(home_object)]);
    assert!(captures_of(&plan, ROOT).is_empty());
    assert!(plan.fields.is_empty());
}

#[test]
fn inner_function_copies_entry_capture() {
    let mut fixture = Fixture::new();
    let method = fixture.add_function(ROOT, 3);
    let home_object = fixture.add_home_object(method, ScopeId(1));
    let inner = fixture.add_function(method, 5);
    fixture.uses.push((inner, home_object));
    let plan = fixture.solve(NO_LIMIT);
    assert_eq!(captures_of(&plan, inner), [Capture::Value(home_object)]);
    assert_eq!(captures_of(&plan, method), [Capture::Value(home_object)]);
    assert!(captures_of(&plan, ROOT).is_empty());
    assert!(plan.fields.is_empty());
}

fn add_root_constants(fixture: &mut Fixture, count: u32) -> Vec<BindingRef> {
    (1..=count)
        .map(|time| fixture.add_root_constant(time))
        .collect()
}

#[test]
fn limit_turns_copies_into_environments() {
    let mut fixture = Fixture::new();
    let bindings = add_root_constants(&mut fixture, 4);
    let user = fixture.add_function(ROOT, 9);
    for &binding in &bindings {
        fixture.uses.push((user, binding));
    }
    let plan = fixture.solve(3);
    assert_eq!(captures_of(&plan, user), [ENVIRONMENT]);
    assert_eq!(plan.functions_over_limit, [user]);
    assert_eq!(plan.fields, bindings);
}

#[test]
fn limit_of_one_function_leaves_others() {
    let mut fixture = Fixture::new();
    let bindings = add_root_constants(&mut fixture, 4);
    let over_limit = fixture.add_function(ROOT, 9);
    let other = fixture.add_function(ROOT, 10);
    for &binding in &bindings {
        fixture.uses.push((over_limit, binding));
    }
    fixture.uses.push((other, bindings[0]));
    let plan = fixture.solve(3);
    assert_eq!(captures_of(&plan, other), [Capture::Value(bindings[0])]);
    assert_eq!(plan.functions_over_limit, [over_limit]);
}

#[test]
fn list_at_the_limit_stays() {
    let mut fixture = Fixture::new();
    let bindings = add_root_constants(&mut fixture, 3);
    let user = fixture.add_function(ROOT, 9);
    for &binding in &bindings {
        fixture.uses.push((user, binding));
    }
    let plan = fixture.solve(3);
    let copies: Vec<Capture> = bindings.iter().copied().map(Capture::Value).collect();
    assert_eq!(captures_of(&plan, user), copies);
    assert!(plan.functions_over_limit.is_empty());
    assert!(plan.fields.is_empty());
}

#[test]
fn entry_capture_stays_a_value_over_the_limit() {
    let mut fixture = Fixture::new();
    let bindings = add_root_constants(&mut fixture, 3);
    let method = fixture.add_function(ROOT, 9);
    let home_object = fixture.add_home_object(method, ScopeId(1));
    for &binding in &bindings {
        fixture.uses.push((method, binding));
    }
    let plan = fixture.solve(3);
    assert_eq!(
        captures_of(&plan, method),
        [ENVIRONMENT, Capture::Value(home_object)]
    );
    assert_eq!(plan.functions_over_limit, [method]);
}

#[test]
fn lists_are_sorted_environments_first() {
    let mut fixture = Fixture::new();
    let inner_scope = ScopeId(3);
    let first_constant = fixture.add_root_constant(1);
    let outer_variable = fixture.add_root_variable(2);
    let second_constant = fixture.add_root_constant(3);
    let outer = fixture.add_function(ROOT, 4);
    let inner_variable = fixture.add_symbol(outer, inner_scope, false, initialized_at(5));
    let home_object = fixture.add_home_object(outer, inner_scope);
    let inner = fixture.add_function(outer, 6);
    let used = [
        home_object,
        second_constant,
        inner_variable,
        first_constant,
        outer_variable,
    ];
    for binding in used {
        fixture.uses.push((inner, binding));
    }
    let plan = fixture.solve(NO_LIMIT);
    assert_eq!(
        captures_of(&plan, inner),
        [
            ENVIRONMENT,
            Capture::Environment(inner_scope),
            Capture::Value(first_constant),
            Capture::Value(second_constant),
            Capture::Value(home_object),
        ]
    );
    assert_eq!(plan.fields, [outer_variable, inner_variable]);
}

#[test]
fn broken_chain_is_unknown() {
    let mut fixture = Fixture::new();
    fixture.functions[ROOT.index()].created_at = 9;
    let owner = fixture.add_function(ROOT, 9);
    let unrelated = fixture.add_function(ROOT, 9);
    let binding = fixture.add_symbol(owner, ScopeId(1), true, initialized_at(3));
    assert!(fixture.is_initialized_before(binding, owner, u32::MAX));
    assert!(!fixture.is_initialized_before(binding, unrelated, u32::MAX));
}

#[test]
fn time_inside_the_owner() {
    let mut fixture = Fixture::new();
    let binding = fixture.add_root_constant(5);
    assert!(fixture.is_initialized_before(binding, ROOT, 6));
    assert!(!fixture.is_initialized_before(binding, ROOT, 5));
    assert!(!fixture.is_initialized_before(binding, ROOT, 4));
}

#[test]
fn time_inside_a_later_function() {
    let mut fixture = Fixture::new();
    let binding = fixture.add_root_constant(5);
    let early = fixture.add_function(ROOT, 2);
    let late = fixture.add_function(ROOT, 7);
    assert!(fixture.is_initialized_before(binding, late, 8));
    assert!(!fixture.is_initialized_before(binding, early, 8));
    assert!(!fixture.is_initialized_before(binding, late, 5));
}

// `declare` writes the variable of a level, `use_each` what the innermost function does with the variable of each level.
fn nest_functions(
    depth: usize,
    declare: impl Fn(usize) -> String,
    use_each: impl Fn(usize) -> String,
) -> String {
    let mut source = String::new();
    for level in 0..depth {
        source += &format!("function f{level}() {{ {}\n", declare(level));
    }
    source.extend((0..depth).map(use_each));
    for level in (1..depth).rev() {
        source += &format!("}}\nf{level}();\n");
    }
    source + "}\nf0();\n"
}

// The most captures of a function, and the most fields of an environment.
fn lower_nested_functions(source: &str) -> (usize, usize) {
    let lowered = lower_program_with_limits(&[("main.js", source)], LimitValues::for_host());
    let fragment = &lowered[0].1.fragment;
    let functions = fragment.functions.iter();
    let captures = functions.map(|(_, function)| function.captures.len());
    let layouts = fragment.layouts.iter();
    let environments = layouts.filter(|(_, layout)| layout.kind == LayoutKind::Environment);
    let fields = environments.map(|(_, layout)| layout.fields.len());
    (captures.max().unwrap_or(0), fields.max().unwrap_or(0))
}

#[test]
fn function_that_reaches_too_many_scopes_gets_its_captures_in_one_object() {
    let stored = |depth| {
        nest_functions(
            depth,
            |level| format!("let v{level} = {level};"),
            |level| format!("v{level}++;"),
        )
    };
    // The innermost function has a variable of its own and captures an environment for each level around it.
    assert_eq!(
        lower_nested_functions(&stored(max_captures() + 1)),
        (max_captures(), 1)
    );
    assert_eq!(
        lower_nested_functions(&stored(max_captures() + 3)),
        (max_captures(), max_captures() + 2)
    );
}

#[test]
fn copies_of_too_many_scopes_come_in_one_object_too() {
    let read = |depth| {
        nest_functions(
            depth,
            |level| format!("const c{level} = Math.random();"),
            |level| format!("c{level};"),
        )
    };
    let (captures, fields) = lower_nested_functions(&read(max_captures() + 3));
    assert_eq!(captures, max_captures());
    assert_eq!(fields, max_captures() + 2);
}

#[test]
fn function_that_is_left_out_copies_a_constant_that_is_left_out_with_it() {
    let files = [
        (
            "main.cjs",
            "const k = require('./k.cjs'); console.log(k.read());",
        ),
        (
            "k.cjs",
            "'use strict';\n\
            class OnlyMadeInUnread {}\n\
            function choose() { return Object; }\n\
            class Unread extends choose() { make() { return new OnlyMadeInUnread(); } }\n\
            exports.Unread = Unread;\n\
            exports.read = () => 1;",
        ),
    ];
    let settings = default_settings();
    let entry_count = lower_and_link_program(&files, &settings, |program, _| program.entries.len());
    assert_eq!(entry_count, 1);
}
