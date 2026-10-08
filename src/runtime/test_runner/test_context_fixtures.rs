//! vitest's fixtures: `test.extend({ name: async ({ dependency }, use) => { ...; await use(value); ... } })`.
//!
//! A fixture is set up before the first callback of a test that destructures it from the context, by an entry put
//! in front of that callback's (`next`), and torn down by an entry that runs after the hooks of the test.

use core::cell::Cell;

use bun_core::String as BunString;
use bun_jsc::{
    self as jsc, CallFrame, JSFunction, JSGlobalObject, JSHostFn, JSPromise, JSValue, JsCell,
    JsClass as _, JsResult,
};

use super::bun_test::{self, BunTest, DescribeScope};
use super::jest::Jest;
use super::test_context::{Deferred, TestContext};
use super::test_context_parameter::ContextParameter;

/// A fixture cannot depend on one that lives shorter than itself.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum Scope {
    Test,
    File,
    /// A file has the process to itself as far as fixtures can tell, so this is torn down with the file's.
    Worker,
}

impl Scope {
    fn name(self) -> &'static str {
        match self {
            Scope::Test => "test",
            Scope::File => "file",
            Scope::Worker => "worker",
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Kind {
    Value,
    /// `async (context, use) => { await use(value) }`
    Use,
    /// `test.extend(name, async (context, { onCleanup }) => value)`
    Builder,
}

#[derive(Clone)]
struct Definition {
    name: Box<[u8]>,
    kind: Kind,
    auto: bool,
    scope: Scope,
    dependencies: Vec<Box<[u8]>>,
    /// The definition of the same name that this one replaced, which is what it gets under that name.
    parent: Option<usize>,
}

struct Override {
    scope: *const DescribeScope,
    registrations: Vec<usize>,
}

/// What `test.extend()` was given, and all that the function it was called on had.
#[bun_jsc::JsClass(no_construct, no_constructor)]
pub(crate) struct TestFixtures {
    /// Replaced ones too. The value or the function of each is in `js::values`.
    definitions: JsCell<Vec<Definition>>,
    /// What each name stands for, in the order the names were first defined.
    registrations: JsCell<Vec<usize>>,
    /// `test.override()` in a describe block.
    overrides: JsCell<Vec<Override>>,
    /// The file- and worker-scoped fixtures that were started. The `ActiveFixture` of each is in `js::scoped`.
    scoped: JsCell<Vec<usize>>,
    /// `BunTestRoot::file_generation` of the file that `overrides` and `scoped` are about.
    generation: Cell<u32>,
}

pub(crate) mod js {
    bun_jsc::codegen_cached_accessors!("TestFixtures"; values, scoped);
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum State {
    NotStarted,
    SettingUp,
    Ready,
    Done,
}

/// One run of a fixture function.
#[bun_jsc::JsClass(no_construct, no_constructor)]
pub(crate) struct ActiveFixture {
    definition: usize,
    /// Of the entry that tears it down.
    timeout: u32,
    state: Cell<State>,
}

mod active {
    bun_jsc::codegen_cached_accessors!("ActiveFixture"; fixtures, context, value, ready, release, returned, cleanup);
}

pub(crate) enum Next {
    /// Everything the callback asks for is there.
    Ready,
    /// Run this first, then ask again.
    SetUp(JSValue),
}

const BUILTIN: [&[u8]; 8] =
    [b"task", b"expect", b"signal", b"skip", b"annotate", b"onTestFinished", b"onTestFailed", b"bench"];

fn quoted(name: &[u8]) -> impl core::fmt::Display + '_ {
    bun_core::fmt::quote(name)
}

fn bound(global: &JSGlobalObject, this_value: JSValue, name: &'static str, function: JSHostFn) -> JsResult<JSValue> {
    JSFunction::create(global, name, function, 1, Default::default()).bind(
        global,
        this_value,
        &BunString::static_(name),
        1.0,
        &[],
    )
}

fn settle(global: &JSGlobalObject, promise: Option<JSValue>, value: Result<JSValue, JSValue>) -> JsResult<()> {
    let Some(promise) = promise.and_then(JSValue::as_promise) else {
        return Ok(());
    };
    let promise = JSPromise::opaque_mut(promise);
    match value {
        Ok(value) => promise.resolve(global, value),
        Err(error) => promise.reject(global, Ok(error)),
    }
}

fn current_generation() -> u32 {
    // SAFETY: the runner outlives every test file and is only touched on this thread.
    Jest::runner_ptr().map_or(0, |runner| unsafe { (*runner.as_ptr()).bun_test_root.file_generation })
}

impl TestFixtures {
    fn of<'a>(value: JSValue) -> Option<&'a TestFixtures> {
        // SAFETY: the wrapper owns the payload; every caller holds `value` on the stack or in a slot for as long as it uses the borrow.
        TestFixtures::from_js(value).map(|this| unsafe { &*this })
    }

    /// Forgets what is about an earlier file: a helper module can be shared by several.
    fn enter_file(&self, this_value: JSValue, global: &JSGlobalObject) {
        let generation = current_generation();
        if self.generation.replace(generation) != generation {
            self.overrides.with_mut(Vec::clear);
            self.scoped.with_mut(Vec::clear);
            js::scoped_set_cached(this_value, global, JSValue::UNDEFINED);
        }
    }

    fn value_of(this_value: JSValue, global: &JSGlobalObject, definition: usize) -> JsResult<JSValue> {
        match js::values_get_cached(this_value) {
            Some(values) => values.get_index(global, definition as u32),
            None => Ok(JSValue::UNDEFINED),
        }
    }

    /// The closest `test.override()` around `scope`, else what `test.extend()` defined.
    fn registrations_in(&self, mut scope: Option<*mut DescribeScope>) -> Vec<usize> {
        let overrides = self.overrides.get();
        while let Some(current) = scope.filter(|_| !overrides.is_empty()) {
            if let Some(found) = overrides.iter().find(|candidate| core::ptr::eq(candidate.scope, current)) {
                return found.registrations.clone();
            }
            // SAFETY: a scope of the file that is running, whose describe tree is alive.
            scope = unsafe { (*current).base.parent };
        }
        self.registrations.get().clone()
    }

    fn find(definitions: &[Definition], registrations: &[usize], name: &[u8]) -> Option<usize> {
        registrations.iter().copied().find(|&index| *definitions[index].name == *name)
    }

    pub(crate) fn has_scope_beyond_test(value: JSValue) -> bool {
        Self::of(value).is_some_and(|this| this.definitions.get().iter().any(|definition| definition.scope != Scope::Test))
    }

    /// `test.extend(fixtures)`, `test.extend(name, value)`, `test.extend(name, options, value)`: a new set.
    /// `test.override(...)`, with `override_in`: changes `parent` for that scope, or for good at the top level.
    pub(crate) fn define(
        global: &JSGlobalObject,
        frame: &CallFrame,
        signature: &str,
        parent: JSValue,
        active_scope: *const DescribeScope,
        is_top_level: bool,
        is_override: bool,
    ) -> JsResult<JSValue> {
        let [first, second, third] = frame.arguments_as_array::<3>();
        let parent_fixtures = Self::of(parent);
        if let Some(parent_fixtures) = parent_fixtures {
            parent_fixtures.enter_file(parent, global);
        }
        let mut definitions = parent_fixtures.map_or_else(Vec::new, |parent| parent.definitions.get().clone());
        let mut registrations = match parent_fixtures {
            Some(parent) if is_override => parent.registrations_in(Some(active_scope.cast_mut())),
            Some(parent) => parent.registrations.get().clone(),
            None => Vec::new(),
        };
        let values = JSValue::create_empty_array(global, 0)?;
        for index in 0..definitions.len() {
            values.push(global, Self::value_of(parent, global, index)?)?;
        }

        let mut errors: Vec<String> = Vec::new();
        let mut add = |name: &[u8], value: JSValue, options: JSValue, function_kind: Kind| -> JsResult<()> {
            let replaced = Self::find(&definitions, &registrations, name);
            let (mut auto, mut scope) = replaced.map_or((false, Scope::Test), |index| (definitions[index].auto, definitions[index].scope));
            if options.is_object() {
                let given_auto = options.get(global, "auto")?.is_some_and(JSValue::to_boolean);
                let given_scope = match options.get(global, "scope")? {
                    None => Scope::Test,
                    Some(given) => {
                        let given = given.to_utf8(global)?;
                        match given.slice() {
                            b"test" => Scope::Test,
                            b"file" => Scope::File,
                            b"worker" => Scope::Worker,
                            unknown => {
                                errors.push(format!(
                                    "{signature}: fixture {} has the unknown scope {}. Expected \"test\", \"file\" or \"worker\"",
                                    quoted(name),
                                    quoted(unknown),
                                ));
                                Scope::Test
                            }
                        }
                    }
                };
                if replaced.is_some() && given_scope != scope {
                    errors.push(format!("{signature}: fixture {} is already defined with the scope \"{}\"", quoted(name), scope.name()));
                }
                if replaced.is_some() && given_auto != auto {
                    errors.push(format!("{signature}: fixture {} is already defined with {{ auto: {auto} }}", quoted(name)));
                }
                (auto, scope) = (given_auto, given_scope);
            }
            if !is_top_level && scope != Scope::Test {
                errors.push(format!(
                    "{signature}: the {}-scoped fixture {} cannot be defined inside describe(). Define it at the top level of the file",
                    scope.name(),
                    quoted(name),
                ));
            }
            let mut dependencies = Vec::new();
            if value.is_callable() {
                match ContextParameter::of(value, 0) {
                    ContextParameter::Absent => {}
                    ContextParameter::Properties(names) => dependencies = names,
                    ContextParameter::RestProperty => errors.push(format!(
                        "{signature}: the first parameter of fixture {} cannot have a rest property",
                        quoted(name),
                    )),
                    ContextParameter::Other(Some(parameter)) => errors.push(format!(
                        "{signature}: the first parameter of fixture {} must be an object destructuring pattern, received {}",
                        quoted(name),
                        quoted(&parameter),
                    )),
                    ContextParameter::Other(None) => errors.push(format!(
                        "{signature}: the first parameter of fixture {} must be an object destructuring pattern",
                        quoted(name),
                    )),
                }
            }
            let index = definitions.len();
            definitions.push(Definition {
                name: name.into(),
                kind: if value.is_callable() { function_kind } else { Kind::Value },
                auto,
                scope,
                dependencies,
                parent: replaced,
            });
            values.push(global, value)?;
            match registrations.iter_mut().find(|registered| Some(**registered) == replaced) {
                Some(registered) => *registered = index,
                None => registrations.push(index),
            }
            Ok(())
        };

        if first.is_string() {
            let name = first.to_utf8(global)?;
            let (options, value) = if !third.is_undefined() {
                (second, third)
            } else if Self::is_options(global, second)? {
                (second, JSValue::create_empty_object(global, 0))
            } else {
                (JSValue::UNDEFINED, second)
            };
            add(name.slice(), value, options, Kind::Builder)?;
        } else if first.is_object() && !first.is_callable() {
            let entries = jsc::JSPropertyIterator::init(
                global,
                first.to_object(global)?,
                jsc::JSPropertyIteratorOptions::new(false, true),
            )?;
            while let Some((name, value)) = entries.next()? {
                let mut options = JSValue::UNDEFINED;
                let mut value = value;
                if value.is_array() && value.get_length(global)? >= 2 {
                    let candidate = value.get_index(global, 1)?;
                    if Self::is_options(global, candidate)? {
                        options = candidate;
                        value = value.get_index(global, 0)?;
                    }
                }
                add(name.to_utf8().slice(), value, options, Kind::Use)?;
            }
        } else {
            return Err(global.throw_invalid_argument_type_value_one_of("fixtures", "object or string", first));
        }

        for &index in &registrations {
            let fixture = &definitions[index];
            for dependency in &fixture.dependencies {
                if BUILTIN.contains(&&**dependency) {
                    continue;
                }
                let Some(found) = Self::find(&definitions, &registrations, dependency) else {
                    errors.push(format!(
                        "{signature}: fixture {} depends on {}, which is not a fixture",
                        quoted(&fixture.name),
                        quoted(dependency),
                    ));
                    continue;
                };
                if found == index && fixture.parent.is_none() {
                    errors.push(format!(
                        "{signature}: fixture {0} depends on itself, and there is no earlier {0} for it to extend",
                        quoted(&fixture.name),
                    ));
                } else if fixture.scope > definitions[found].scope {
                    errors.push(format!(
                        "{signature}: the {}-scoped fixture {} cannot depend on the {}-scoped fixture {}",
                        fixture.scope.name(),
                        quoted(&fixture.name),
                        definitions[found].scope.name(),
                        quoted(dependency),
                    ));
                }
            }
        }
        match &errors[..] {
            [] => {}
            [error] => return Err(global.throw(format_args!("{error}"))),
            errors => {
                let array = JSValue::create_empty_array(global, 0)?;
                for error in errors {
                    array.push(global, global.create_error_instance(format_args!("{error}")))?;
                }
                let error = global.create_aggregate_error_with_array(
                    array,
                    format_args!("{signature}: {} of the fixtures cannot be used", errors.len()),
                )?;
                return Err(global.throw_value(error));
            }
        }

        if let (true, Some(parent_fixtures)) = (is_override, parent_fixtures) {
            parent_fixtures.definitions.set(definitions);
            js::values_set_cached(parent, global, values);
            if is_top_level {
                parent_fixtures.registrations.set(registrations);
            } else {
                parent_fixtures.overrides.with_mut(|overrides| {
                    overrides.retain(|existing| !core::ptr::eq(existing.scope, active_scope));
                    overrides.push(Override { scope: active_scope, registrations });
                });
            }
            return Ok(parent);
        }
        let fixtures = TestFixtures {
            definitions: JsCell::new(definitions),
            registrations: JsCell::new(registrations),
            overrides: JsCell::new(Vec::new()),
            scoped: JsCell::new(Vec::new()),
            generation: Cell::new(current_generation()),
        }
        .to_js(global);
        js::values_set_cached(fixtures, global, values);
        Ok(fixtures)
    }

    /// `[value, options]` is a fixture with options only if `options` has one of them.
    fn is_options(global: &JSGlobalObject, value: JSValue) -> JsResult<bool> {
        if !value.is_object() || value.is_array() || value.is_callable() {
            return Ok(false);
        }
        for option in ["auto", "scope", "injected"] {
            if value.get(global, option)?.is_some() {
                return Ok(true);
            }
        }
        Ok(false)
    }

    /// The fixtures to set up for a callback that destructures `names`, each after what it depends on.
    fn order(
        global: &JSGlobalObject,
        definitions: &[Definition],
        registrations: &[usize],
        names: &[Box<[u8]>],
        in_suite_hook: bool,
    ) -> JsResult<Vec<usize>> {
        let mut order: Vec<usize> = Vec::new();
        // (definition, how many of its dependencies were visited)
        let mut stack: Vec<(usize, usize)> = Vec::new();
        for &wanted in registrations {
            let fixture = &definitions[wanted];
            let is_auto = fixture.auto && !(in_suite_hook && fixture.scope == Scope::Test);
            if !is_auto && !names.iter().any(|name| **name == *fixture.name) {
                continue;
            }
            stack.push((wanted, 0));
            while let Some(top) = stack.last_mut() {
                let (index, visited) = *top;
                top.1 += 1;
                let fixture = &definitions[index];
                if order.contains(&index) {
                    stack.pop();
                    continue;
                }
                let Some(dependency) = fixture.dependencies.get(visited) else {
                    order.push(index);
                    stack.pop();
                    continue;
                };
                let next = if **dependency == *fixture.name {
                    fixture.parent
                } else {
                    Self::find(definitions, registrations, dependency)
                };
                let Some(next) = next else { continue };
                if stack.iter().any(|&(open, _)| open == next) {
                    let mut cycle = String::new();
                    for &(open, _) in stack.iter().skip_while(|&&(open, _)| open != next) {
                        cycle.push_str(&format!("{} <- ", bstr::BStr::new(&definitions[open].name)));
                    }
                    return Err(global.throw(format_args!(
                        "Fixtures depend on each other: {cycle}{}",
                        bstr::BStr::new(&definitions[next].name),
                    )));
                }
                stack.push((next, 0));
            }
        }
        Ok(order)
    }

    /// What is left to do before a callback that destructures `parameter` from `context` can run.
    /// `context`: the `TestContext`, or for `beforeAll` / `afterAll` the object they get.
    pub(crate) fn next(
        this_value: JSValue,
        global: &JSGlobalObject,
        context: JSValue,
        scope: Option<*mut DescribeScope>,
        parameter: &ContextParameter,
        timeout: u32,
    ) -> JsResult<Next> {
        let Some(this) = Self::of(this_value) else {
            return Ok(Next::Ready);
        };
        this.enter_file(this_value, global);
        let names: &[Box<[u8]>] = match parameter {
            ContextParameter::Properties(names) => names,
            ContextParameter::Absent => &[],
            ContextParameter::RestProperty => {
                return Err(global.throw(format_args!(
                    "The parameter that fixtures are destructured from cannot have a rest property"
                )));
            }
            ContextParameter::Other(Some(parameter)) => {
                return Err(global.throw(format_args!(
                    "The parameter that fixtures are destructured from must be an object destructuring pattern, received {}",
                    quoted(parameter),
                )));
            }
            ContextParameter::Other(None) => {
                return Err(global.throw(format_args!(
                    "The parameter that fixtures are destructured from must be an object destructuring pattern"
                )));
            }
        };
        let test_context = TestContext::from_js(context);
        let definitions = this.definitions.get();
        let registrations = this.registrations_in(scope);
        for index in Self::order(global, definitions, &registrations, names, test_context.is_none())? {
            let fixture = &definitions[index];
            let name = BunString::clone_utf8(&fixture.name);
            if fixture.scope != Scope::Test {
                let started = this.scoped.get().iter().position(|&started| started == index);
                let active_fixture = match (started, js::scoped_get_cached(this_value)) {
                    (Some(position), Some(cells)) => cells.get_index(global, position as u32)?,
                    _ => Self::start_scoped(this, this_value, global, index, timeout)?,
                };
                match ActiveFixture::of(active_fixture).map(|active_fixture| active_fixture.state.get()) {
                    Some(State::Ready) => {
                        context.put(global, name, active::value_get_cached(active_fixture).unwrap_or(JSValue::UNDEFINED));
                        continue;
                    }
                    _ => return Ok(Next::SetUp(bound(global, active_fixture, "setUp", __jsc_host_set_up)?)),
                }
            }
            // SAFETY: the wrapper owns the payload, and the caller keeps `context` alive.
            let Some(test_context) = test_context.map(|test_context| unsafe { &*test_context }) else {
                return Err(global.throw(format_args!(
                    "The test-scoped fixture {} cannot be used in beforeAll() or afterAll(). Give it {{ scope: \"file\" }}, or use beforeEach() or afterEach()",
                    quoted(&fixture.name),
                )));
            };
            if test_context.has_fixture(index) {
                continue;
            }
            if fixture.kind == Kind::Value {
                test_context.add_fixture(index);
                context.put(global, name, Self::value_of(this_value, global, index)?);
                continue;
            }
            let active_fixture = ActiveFixture::create(global, this_value, context, index, timeout);
            return Ok(Next::SetUp(bound(global, active_fixture, "setUp", __jsc_host_set_up)?));
        }
        Ok(Next::Ready)
    }

    fn start_scoped(
        &self,
        this_value: JSValue,
        global: &JSGlobalObject,
        index: usize,
        timeout: u32,
    ) -> JsResult<JSValue> {
        let scope = self.definitions.get()[index].scope;
        let context = self.scoped_context(this_value, global, scope)?;
        let active_fixture = ActiveFixture::create(global, this_value, context, index, timeout);
        let cells = match js::scoped_get_cached(this_value).filter(|cells| cells.is_array()) {
            Some(cells) => cells,
            None => {
                let cells = JSValue::create_empty_array(global, 0)?;
                js::scoped_set_cached(this_value, global, cells);
                cells
            }
        };
        cells.push(global, active_fixture)?;
        self.scoped.with_mut(|scoped| scoped.push(index));
        if self.definitions.get()[index].kind == Kind::Value
            && let Some(active_fixture_payload) = ActiveFixture::of(active_fixture)
        {
            active::value_set_cached(active_fixture, global, Self::value_of(this_value, global, index)?);
            active_fixture_payload.state.set(State::Ready);
        }
        Ok(active_fixture)
    }

    /// An object with the fixtures of `scope` and beyond that are set up.
    fn scoped_context(&self, this_value: JSValue, global: &JSGlobalObject, scope: Scope) -> JsResult<JSValue> {
        let context = JSValue::create_empty_object(global, 0);
        let Some(cells) = js::scoped_get_cached(this_value).filter(|cells| cells.is_array()) else {
            return Ok(context);
        };
        for (position, &index) in self.scoped.get().iter().enumerate() {
            let fixture = &self.definitions.get()[index];
            let active_fixture = cells.get_index(global, position as u32)?;
            if fixture.scope >= scope
                && ActiveFixture::of(active_fixture).is_some_and(|active_fixture| active_fixture.state.get() == State::Ready)
            {
                context.put(
                    global,
                    BunString::clone_utf8(&fixture.name),
                    active::value_get_cached(active_fixture).unwrap_or(JSValue::UNDEFINED),
                );
            }
        }
        Ok(context)
    }

    /// What `test.beforeAll()` / `test.afterAll()` callbacks destructure fixtures from.
    pub(crate) fn suite_hook_context(this_value: JSValue, global: &JSGlobalObject) -> JsResult<JSValue> {
        match Self::of(this_value) {
            Some(this) => {
                this.enter_file(this_value, global);
                this.scoped_context(this_value, global, Scope::File)
            }
            None => Ok(JSValue::create_empty_object(global, 0)),
        }
    }
}

impl ActiveFixture {
    fn create(global: &JSGlobalObject, fixtures: JSValue, context: JSValue, definition: usize, timeout: u32) -> JSValue {
        let this_value = ActiveFixture { definition, timeout, state: Cell::new(State::NotStarted) }.to_js(global);
        active::fixtures_set_cached(this_value, global, fixtures);
        active::context_set_cached(this_value, global, context);
        this_value
    }

    fn of<'a>(value: JSValue) -> Option<&'a ActiveFixture> {
        // SAFETY: as `TestFixtures::of`.
        ActiveFixture::from_js(value).map(|this| unsafe { &*this })
    }

    /// The fixture a function made by `bound` is called on, and its definition.
    fn of_call<'a>(global: &JSGlobalObject, frame: &'a CallFrame) -> JsResult<(&'a ActiveFixture, &'a Definition)> {
        if let Some(this) = Self::of(frame.this())
            && let Some(fixtures) = active::fixtures_get_cached(frame.this()).and_then(TestFixtures::of)
            && let Some(definition) = fixtures.definitions.get().get(this.definition)
        {
            return Ok((this, definition));
        }
        Err(global.throw_type_error(format_args!("Expected this to be a fixture")))
    }

    /// The fixture has its value: the callbacks that wait for it can go on, and it is torn down after them.
    fn provide(&self, this_value: JSValue, global: &JSGlobalObject, definition: &Definition, value: JSValue) -> JsResult<()> {
        self.state.set(State::Ready);
        active::value_set_cached(this_value, global, value);
        let tear_down = bound(global, this_value, "tearDown", __jsc_host_tear_down)?;
        let context = active::context_get_cached(this_value).unwrap_or(JSValue::UNDEFINED);
        if let Some(buntest) = bun_test::clone_active_strong() {
            let buntest: &mut BunTest = buntest.get();
            match TestContext::from_js(context) {
                // SAFETY: the wrapper owns the payload, and the slot keeps the wrapper alive.
                Some(test_context) if definition.scope == Scope::Test => unsafe {
                    (*test_context).add_fixture(self.definition);
                    context.put(global, BunString::clone_utf8(&definition.name), value);
                    (*test_context).defer(buntest, Deferred::Fixture, tear_down, self.timeout);
                },
                _ => buntest.defer_to_file_end(tear_down, self.timeout),
            }
        }
        settle(global, active::ready_get_cached(this_value), Ok(JSValue::UNDEFINED))
    }

    /// The fixture function returned `returned`, or a promise of it.
    fn on_returned(&self, this_value: JSValue, global: &JSGlobalObject, definition: &Definition, returned: JSValue) -> JsResult<()> {
        if self.state.get() != State::SettingUp {
            return Ok(());
        }
        if definition.kind == Kind::Builder {
            return self.provide(this_value, global, definition, returned);
        }
        self.state.set(State::Done);
        let error = global.create_error_instance(format_args!("Fixture {} returned without calling use()", quoted(&definition.name)));
        settle(global, active::ready_get_cached(this_value), Err(error))
    }
}

/// The callback of the entry that sets the fixture up: a promise for when it has its value.
#[bun_jsc::host_fn]
fn set_up(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let this_value = frame.this();
    let (this, definition) = ActiveFixture::of_call(global, frame)?;
    if this.state.get() != State::NotStarted {
        // A concurrent test started it.
        return Ok(active::ready_get_cached(this_value).unwrap_or(JSValue::UNDEFINED));
    }
    this.state.set(State::SettingUp);
    let ready = JSPromise::create(global).to_js();
    active::ready_set_cached(this_value, global, ready);

    let fixtures = active::fixtures_get_cached(this_value).unwrap_or(JSValue::UNDEFINED);
    let function = TestFixtures::value_of(fixtures, global, this.definition)?;
    let context = active::context_get_cached(this_value).unwrap_or(JSValue::UNDEFINED);
    let second = match definition.kind {
        Kind::Builder => {
            let helpers = JSValue::create_empty_object(global, 1);
            helpers.put(global, b"onCleanup", bound(global, this_value, "onCleanup", __jsc_host_on_cleanup)?);
            helpers
        }
        Kind::Use | Kind::Value => bound(global, this_value, "use", __jsc_host_use_fixture)?,
    };
    let returned = match function.call(global, JSValue::UNDEFINED, &[context, second]) {
        Ok(returned) => returned,
        Err(err) => {
            this.state.set(State::Done);
            return Err(err);
        }
    };
    active::returned_set_cached(this_value, global, returned);
    let then = if returned.is_object() { returned.get(global, "then")?.filter(|then| then.is_callable()) } else { None };
    let (this, definition) = ActiveFixture::of_call(global, frame)?;
    match then {
        Some(then) => {
            let reactions = [
                bound(global, this_value, "", __jsc_host_on_fulfilled)?,
                bound(global, this_value, "", __jsc_host_on_rejected)?,
            ];
            then.call(global, returned, &reactions)?;
        }
        None => this.on_returned(this_value, global, definition, returned)?,
    }
    Ok(ready)
}

#[bun_jsc::host_fn]
fn on_fulfilled(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let (this, definition) = ActiveFixture::of_call(global, frame)?;
    this.on_returned(frame.this(), global, definition, frame.argument(0))?;
    Ok(JSValue::UNDEFINED)
}

/// After `use()`, the entry that tears the fixture down reports it: it waits for the same promise.
#[bun_jsc::host_fn]
fn on_rejected(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let (this, _) = ActiveFixture::of_call(global, frame)?;
    if this.state.get() == State::SettingUp {
        this.state.set(State::Done);
        settle(global, active::ready_get_cached(frame.this()), Err(frame.argument(0)))?;
    }
    Ok(JSValue::UNDEFINED)
}

/// `use(value)`: a promise for when the fixture is to tear itself down.
#[bun_jsc::host_fn]
fn use_fixture(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let this_value = frame.this();
    let (this, definition) = ActiveFixture::of_call(global, frame)?;
    if this.state.get() != State::SettingUp {
        return Err(global.throw(format_args!("use() of fixture {} was called more than once", quoted(&definition.name))));
    }
    let release = JSPromise::create(global).to_js();
    active::release_set_cached(this_value, global, release);
    this.provide(this_value, global, definition, frame.argument(0))?;
    Ok(release)
}

#[bun_jsc::host_fn]
fn on_cleanup(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let this_value = frame.this();
    let (_, definition) = ActiveFixture::of_call(global, frame)?;
    let cleanup = frame.argument(0);
    if !cleanup.is_callable() {
        return Err(global.throw_invalid_argument_type_value("cleanup", "function", cleanup));
    }
    if active::cleanup_get_cached(this_value).is_some() {
        return Err(global.throw(format_args!("onCleanup() of fixture {} was called more than once", quoted(&definition.name))));
    }
    active::cleanup_set_cached(this_value, global, cleanup);
    Ok(JSValue::UNDEFINED)
}

/// The callback of the entry that tears the fixture down: a promise for when it has.
#[bun_jsc::host_fn]
fn tear_down(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let this_value = frame.this();
    let (this, definition) = ActiveFixture::of_call(global, frame)?;
    this.state.set(State::Done);
    if let Some(test_context) = active::context_get_cached(this_value).and_then(TestContext::from_js) {
        // SAFETY: the wrapper owns the payload, and the slot keeps the wrapper alive.
        unsafe { &*test_context }.remove_fixture(this.definition);
    }
    if definition.kind == Kind::Builder {
        return match active::cleanup_get_cached(this_value) {
            Some(cleanup) => cleanup.call(global, JSValue::UNDEFINED, &[]),
            None => Ok(JSValue::UNDEFINED),
        };
    }
    settle(global, active::release_get_cached(this_value), Ok(JSValue::UNDEFINED))?;
    Ok(active::returned_get_cached(this_value).unwrap_or(JSValue::UNDEFINED))
}
