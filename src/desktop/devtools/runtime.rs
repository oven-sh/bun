//! The domain `Runtime`.

use core::ops::ControlFlow;
use std::rc::{Rc, Weak};

use bun_jsc::{StringJsc as _, Strong, from_js_host_call_generic};
use bun_ui::dom;
use bun_web::host::Logged;

use super::contents::Contents;
use super::mirror::{Form, Objects, place_of_function, text_in};
use super::{Emit, Failure, Outcome, pure};
use crate::contents::can_evaluate;
use crate::prelude::*;
use crate::realm::{self, Realm};
use crate::renderer::{Document, OF_PRELOAD, World, disposed};
use crate::task;
use crate::value::Value;

#[repr(C)]
struct EvalPolicy {
    allows: bool,
    watches: bool,
}

unsafe extern "C" {
    safe fn Bun__Inspector__refusal(realm: &Realm) -> JSValue;
    safe fn Bun__Inspector__stack(realm: &Realm, thrown: JSValue, most: u32) -> JSValue;
    safe fn Bun__Inspector__syntaxError(
        realm: &Realm,
        source: &bun_core::String,
        line: &mut u32,
    ) -> bun_core::String;
    safe fn Bun__Inspector__useConsole(realm: &Realm, helpers: JSValue, redeclares: bool);
    safe fn Bun__DesktopRealm__allowEval(realm: &Realm) -> EvalPolicy;
    safe fn Bun__DesktopRealm__restrictCode(
        realm: &Realm,
        allows_eval: bool,
        allows_web_assembly: bool,
        watches_eval: bool,
    );
    safe fn Bun__IsolatedWorld__hasAdded(realm: &Realm, listener: JSValue) -> bool;
    safe fn Bun__Desktop__set(realm: &Realm, object: JSValue, key: JSValue, value: JSValue);
}

const FIRST_WORLD: u32 = 1 << 20;
const PRELOAD_CONTEXT: &str = "Electron Isolated Context";

#[derive(Clone)]
pub(super) struct Context {
    pub(super) id: u32,
    name: Rc<str>,
    world: u32,
}

pub(super) struct Evaluated {
    pub(super) context: Context,
    pub(super) group: Rc<str>,
    pub(super) result: Result<Strong, Strong>,
    /// It is a promise of an object with a `value`.
    pub(super) is_wrapped: bool,
}

type Settled = task::Receiver<Result<Strong, Strong>>;

pub(super) enum Whose {
    Contents(Contents),
    Page(u32),
}

/// For one document.
pub(super) struct Runtime {
    this: Weak<Runtime>,
    whose: Whose,
    frame: String,
    emit: Emit,
    last_context: Cell<u32>,
    contexts: RefCell<Vec<Context>>,
    pub(super) objects: Objects,
    is_enabled: Cell<bool>,
    /// What `console.js` returns, for each context.
    helpers: RefCell<Vec<(u32, Strong)>>,
    /// They can be handed to the page.
    may_help: Cell<bool>,
    /// `$_`, for each context.
    last_results: RefCell<Vec<(u32, Strong)>>,
    /// `$0` to `$4`
    selected: RefCell<Vec<Strong>>,
    last_exception: Cell<u32>,
    bindings: RefCell<Vec<String>>,
}

const OF_CONSOLE: &str = "console";
/// The helpers that ask something of the client. `PageSession` decides if it hears of that.
pub(super) const REQUESTS: [&str; 2] = ["copy", "inspect"];
pub(super) const REQUESTED: &str = "Runtime.inspectRequested";

fn kept_for(all: &RefCell<Vec<(u32, Strong)>>, context: &Context) -> Option<JSValue> {
    (all.borrow().iter()).find_map(|it| (it.0 == context.id).then(|| it.1.get()))
}

fn group_in(params: &Value) -> Rc<str> {
    params["objectGroup"].text().into()
}

pub(super) fn require_interpreter() -> Result<(), Failure> {
    match can_evaluate()? {
        true => Ok(()),
        false => Err("This program does not run code from strings".into()),
    }
}

pub(super) fn assign(realm: &Realm, to: JSValue, key: JSValue, value: JSValue) -> JsResult<()> {
    from_js_host_call_generic(realm, || Bun__Desktop__set(realm, to, key, value))
}

/// The message and the line.
fn syntax_error(realm: &Realm, source: &str) -> Option<(String, u32)> {
    let (source, mut line) = (bun_core::String::clone_utf8(source.as_bytes()), 0);
    let message = string(&Bun__Inspector__syntaxError(realm, &source, &mut line).to_utf8());
    (!message.is_empty()).then_some((message, line))
}

/// In an async function, which leaves what it declares behind.
fn with_top_level_await(source: &str) -> JsResult<Option<String>> {
    let transform = || {
        let class = get(realm::native(global(), "Bun")?, "Transpiler")?;
        let options = object!({ "loader": "js", "replMode": true });
        let transpiler = realm::instantiate(class, &[options])?;
        text_of(invoke(transpiler, "transformSync", &[js(source)?])?)
    };
    Ok(catch(transform())?.ok())
}

/// `frames` is what `Bun__Inspector__stack` returns.
fn stack_trace(frames: JSValue) -> JsResult<Value> {
    if !frames.is_object() {
        return Ok(Value::Undefined);
    }
    let describe = |[function, url, script, line, column]: &[JSValue; 5]| {
        Ok(record! {
            "functionName": text_of(*function)?,
            "url": text_of(*url)?,
            "scriptId": script.to_u32().to_string(),
            "lineNumber": line.to_u32(),
            "columnNumber": column.to_u32(),
        })
    };
    let all = with_elements(frames, |all| {
        (all.as_chunks().0.iter().map(describe)).collect::<JsResult<Value>>()
    })?;
    Ok(record! { "callFrames": all })
}

/// All that may run a script of the page is done in its realm, and with values of that.
impl World {
    /// Whatever the Content Security Policy says.
    fn with_eval(self, run: &dyn Fn() -> JsResult<JSValue>) -> JsResult<Result<Strong, Strong>> {
        let before = Bun__DesktopRealm__allowEval(self.realm);
        let result = run();
        Bun__DesktopRealm__restrictCode(self.realm, before.allows, true, before.watches);
        Ok(catch(result)?.map(keep).map_err(keep))
    }
}

impl Runtime {
    pub(super) fn new(whose: Whose, emit: Emit, how: &Value) -> Rc<Runtime> {
        let first_context = how["firstContext"].number() as u32;
        Rc::new_cyclic(|this| Runtime {
            this: Weak::clone(this),
            whose,
            frame: how["frame"].text().into(),
            emit,
            last_context: Cell::new(first_context - 1),
            contexts: RefCell::default(),
            objects: Objects::new(first_context),
            is_enabled: Cell::default(),
            helpers: RefCell::default(),
            may_help: Cell::default(),
            last_results: RefCell::default(),
            selected: RefCell::default(),
            last_exception: Cell::default(),
            bindings: RefCell::default(),
        })
    }

    pub(super) fn frame(&self) -> &str {
        &self.frame
    }

    pub(super) fn is_in_app(&self) -> bool {
        matches!(self.whose, Whose::Contents(_))
    }

    pub(super) fn document(&self) -> JsResult<&'static Document> {
        Document::of(match &self.whose {
            Whose::Contents(it) => it.live_page()?.id(),
            Whose::Page(it) => *it,
        })
        .ok_or_else(disposed)
    }

    fn origin(&self) -> String {
        match &self.whose {
            Whose::Contents(it) => it.page().origin(),
            Whose::Page(it) => Document::of(*it).map(Document::origin).unwrap_or_default(),
        }
    }

    fn data_of(&self, context: &Context) -> Value {
        record! {
            "isDefault": context.name.is_empty(),
            "type": if context.name.is_empty() { "default" } else { "isolated" },
            "frameId": self.frame(),
        }
    }

    pub(super) fn contexts(&self) -> JsResult<Vec<Context>> {
        self.find_contexts()?;
        Ok(self.contexts.borrow().clone())
    }

    pub(super) fn context_of(&self, realm: &Realm) -> JsResult<Context> {
        let world = self.document()?.id_of_world(realm)?.ok_or_else(disposed)?;
        if let Some(known) = self.contexts.borrow().iter().find(|it| it.world == world) {
            return Ok(known.clone());
        }
        match world {
            0 => self.context_named(""),
            OF_PRELOAD => self.context_named(PRELOAD_CONTEXT),
            _ => self.add_context(&format!("World {world}"), world),
        }
    }

    pub(super) fn about_context_of(&self, realm: &Realm) -> JsResult<Value> {
        let context = self.context_of(realm)?;
        Ok(record! {
            "executionContextId": context.id,
            "executionContextAuxData": self.data_of(&context),
        })
    }

    fn announce(&self, it: &Context) -> JsResult<()> {
        let Context { id, name, .. } = it;
        let context = record! {
            "id": *id,
            "name": &**name,
            "origin": self.origin(),
            "uniqueId": id.to_string(),
            "auxData": self.data_of(it),
        };
        let params = record! { "context": context };
        (self.emit)("Runtime.executionContextCreated", params);
        Ok(())
    }

    /// That of the page has no name.
    pub(super) fn context_named(&self, name: &str) -> JsResult<Context> {
        if let Some(known) = self.contexts.borrow().iter().find(|it| *it.name == *name) {
            return Ok(known.clone());
        }
        let world = match name {
            "" => 0,
            PRELOAD_CONTEXT => OF_PRELOAD,
            _ => FIRST_WORLD + self.last_context.get(),
        };
        self.add_context(name, world)
    }

    fn add_context(&self, name: &str, world: u32) -> JsResult<Context> {
        self.last_context.update(|it| it + 1);
        let context = Context {
            id: self.last_context.get(),
            name: name.into(),
            world,
        };
        self.contexts.borrow_mut().push(context.clone());
        if self.is_enabled.get() {
            self.announce(&context)?;
        }
        Ok(context)
    }

    pub(super) fn context(&self, id: &Value) -> Result<Context, Failure> {
        let Some(id) = id.as_number().or_else(|| id.text().parse().ok()) else {
            return Ok(self.context_named("")?);
        };
        let contexts = self.contexts.borrow();
        let found = contexts.iter().find(|it| f64::from(it.id) == id);
        Ok(found
            .ok_or("Cannot find context with specified id")?
            .clone())
    }

    pub(super) fn world_numbered(&self, number: u32) -> JsResult<World> {
        self.document()?.world_with_id(number)
    }

    pub(super) fn world(&self, context: &Context) -> JsResult<World> {
        self.world_numbered(context.world)
    }

    pub(super) fn object_in_page(&self, id: &Value) -> Result<JSValue, Failure> {
        let found = self.objects.find(id)?;
        Ok((self.world(&found.context)?).carry(found.value, self.world_numbered(0)?)?)
    }

    pub(super) fn resolve(&self, node: JSValue, params: &Value) -> Outcome {
        let context = self.context(&params["executionContextId"])?;
        let value = (self.world_numbered(0)?).carry(node, self.world(&context)?)?;
        Ok(self.remote(value, &context, &group_in(params), Form::Reference)?)
    }

    fn settled(&self, value: JSValue, context: &Context) -> JsResult<Settled> {
        let (sender, settled) = task::oneshot();
        let sender = Rc::new(Cell::new(Some(sender)));
        let reaction = |outcome: fn(Strong) -> Result<Strong, Strong>| {
            let sender = Rc::clone(&sender);
            procedure(move |arguments| {
                if let Some(sender) = sender.take() {
                    sender.send(outcome(keep(argument(arguments, 0))));
                }
                Ok(())
            })
        };
        let realm = self.world(context)?.realm;
        react(realm, value, reaction(Ok)?, reaction(Err)?)?;
        Ok(settled)
    }

    pub(super) fn details_of(
        &self,
        thrown: JSValue,
        context: &Context,
        group: &Rc<str>,
    ) -> JsResult<Value> {
        let realm = self.world(context)?.realm;
        let trace = stack_trace(Bun__Inspector__stack(realm, thrown, 200))?;
        let top = &trace["callFrames"][0];
        self.last_exception.update(|it| it + 1);
        Ok(record! {
            "exceptionId": self.last_exception.get(),
            "text": "Uncaught",
            "lineNumber": top["lineNumber"].number(),
            "columnNumber": top["columnNumber"].number(),
            "exception": self.remote(thrown, context, group, Form::Preview)?,
            "stackTrace": top.is_truthy().then_some(&trace),
        })
    }

    pub(super) async fn result(&self, evaluated: Evaluated, params: &Value) -> Outcome {
        let Evaluated {
            context,
            group,
            mut result,
            is_wrapped,
        } = evaluated;
        let awaits = params["awaitPromise"].is_truthy() && !params["replMode"].is_truthy();
        if let Some(value) = result.as_ref().ok().filter(|_| awaits || is_wrapped) {
            let settled = self.settled(value.get(), &context)?;
            drop(result);
            result = settled.await.ok_or("Promise was collected")?;
        }
        self.context(&context.id.into())?;
        let thrown = match result {
            Ok(value) => {
                let mut value = value.get();
                if is_wrapped {
                    let inside = pure::member(self.world(&context)?.realm, value, "value");
                    value = inside.unwrap_or(JSValue::UNDEFINED);
                }
                if *group == *OF_CONSOLE && !value.is_undefined() {
                    let mut all = self.last_results.borrow_mut();
                    all.retain(|it| it.0 != context.id);
                    all.push((context.id, keep(value)));
                }
                match catch(self.remote(value, &context, &group, Form::asked_for(params)))? {
                    Ok(result) => return Ok(record! { "result": result }),
                    Err(thrown) => thrown,
                }
            }
            Err(thrown) => thrown.get(),
        };
        let details = self.details_of(thrown, &context, &group)?;
        Ok(record! { "result": &details["exception"], "exceptionDetails": &details })
    }

    /// Those that scripts of `context` have added.
    fn listeners_of(&self, target: JSValue, context: &Context) -> JsResult<JSValue> {
        let (world, page) = (self.world(context)?, self.world_numbered(0)?);
        let (own, mut count) = (JSValue::create_empty_array(world.realm, 0)?, 0);
        let all = dom::listeners_of(page.realm, world.carry(target, page)?);
        with_elements(all, |all| {
            for it in all {
                let listener = it.get(page.realm, "listener")?.unwrap_or_default();
                if Bun__IsolatedWorld__hasAdded(world.realm, listener) {
                    own.put_index(world.realm, count, page.carry(*it, world)?)?;
                    count += 1;
                }
            }
            Ok(own)
        })
    }

    fn help(&self, context: &Context, what: &str, value: JSValue) -> JsResult<JSValue> {
        let (world, page) = (self.world(context)?, self.world_numbered(0)?);
        match what {
            "$_" => return Ok(kept_for(&self.last_results, context).unwrap_or(JSValue::UNDEFINED)),
            "listeners" => return self.listeners_of(value, context),
            _ if REQUESTS.contains(&what) => {
                let object = self.remote(value, context, &"".into(), Form::Reference)?;
                let hints = record! { "copyToClipboard": (what == "copy").then_some(true) };
                let params =
                    record! { "object": object, "hints": hints, "executionContextId": context.id };
                (self.emit)(REQUESTED, params);
                return Ok(JSValue::UNDEFINED);
            }
            _ => {}
        }
        let index = what
            .strip_prefix('$')
            .and_then(|it| it.parse::<usize>().ok());
        let node = index.and_then(|it| self.selected.borrow().get(it).map(Strong::get));
        node.map_or(Ok(JSValue::UNDEFINED), |it| page.carry(it, world))
    }

    /// `run` gets the helpers, or `undefined` if they are not asked for.
    pub(super) fn with_helpers<T>(
        &self,
        context: &Context,
        params: &Value,
        run: impl FnOnce(JSValue) -> T,
    ) -> JsResult<T> {
        let helpers = match params["includeCommandLineAPI"].is_truthy() {
            true => self.helpers(context)?,
            false => JSValue::UNDEFINED,
        };
        let before = self.may_help.replace(helpers.is_object());
        let result = run(helpers);
        self.may_help.set(before);
        Ok(result)
    }

    fn helpers(&self, context: &Context) -> JsResult<JSValue> {
        let world = self.world(context)?;
        if let Some(make) = kept_for(&self.helpers, context) {
            return make.call(world.realm, JSValue::UNDEFINED, &[]);
        }
        let (this, of) = (Weak::clone(&self.this), context.clone());
        let host = function_in(
            world.realm,
            world.realm.to_js_value(),
            move |realm, given| {
                let realm = realm::of(realm);
                let what = text_in(realm, argument(given, 0))?;
                let is_request = REQUESTS.contains(&&*what);
                let this = (this.upgrade()).filter(|it| is_request || it.may_help.get());
                let help = |it: Rc<Runtime>| it.help(&of, &what, argument(given, 1));
                realm::answer_to(realm, this.map_or(Ok(JSValue::UNDEFINED), help))
            },
        );
        let script = world.evaluate(js(include_str!("console.js"))?)?;
        let make = script.call(world.realm, JSValue::UNDEFINED, &[host])?;
        self.helpers.borrow_mut().push((context.id, keep(make)));
        make.call(world.realm, JSValue::UNDEFINED, &[])
    }

    pub(super) fn select(&self, node: JSValue) {
        let mut selected = self.selected.borrow_mut();
        selected.insert(0, keep(node));
        selected.truncate(5);
    }

    /// `local` finds what is not global.
    pub(super) fn evaluate_purely(
        &self,
        context: &Context,
        source: &str,
        local: &dyn Fn(&str) -> ControlFlow<Option<JSValue>>,
    ) -> JsResult<Result<Strong, Strong>> {
        let world = self.world(context)?;
        if pure::is_constant(source) && can_evaluate()? {
            return world.with_eval(&|| world.evaluate(js(source)?));
        }
        let variable = |name: &str| {
            let helper = || self.help(context, name, JSValue::UNDEFINED).ok();
            local(name).break_value().unwrap_or_else(|| {
                pure::global_variable(world.realm, world.window, name)
                    .or_else(|| name.starts_with('$').then(helper)?)
            })
        };
        Ok(match pure::follow(world.realm, source, &variable)? {
            Some(value) => Ok(keep(value)),
            None => Err(keep(Bun__Inspector__refusal(world.realm))),
        })
    }

    pub(super) fn evaluate(&self, params: &Value) -> Result<Evaluated, Failure> {
        let id = [&params["contextId"], &params["uniqueContextId"]];
        let context = self.context(id[usize::from(id[0].is_nothing())])?;
        let (world, source) = (self.world(&context)?, params["expression"].text());
        let evaluated = |result, is_wrapped| Evaluated {
            context: context.clone(),
            group: group_in(params),
            result,
            is_wrapped,
        };
        if params["throwOnSideEffect"].is_truthy() {
            let result = self.evaluate_purely(&context, source, &|_| ControlFlow::Continue(()))?;
            return Ok(evaluated(result, false));
        }
        require_interpreter()?;
        let is_typed = params["replMode"].is_truthy();
        let awaits = is_typed
            && crate::text::contains(source, "await")
            && syntax_error(world.realm, source).is_some();
        let wrapped = if awaits {
            with_top_level_await(source)?
        } else {
            None
        };
        let result = self.with_helpers(&context, params, |helpers| {
            Bun__Inspector__useConsole(world.realm, helpers, is_typed);
            let source = wrapped.as_deref().unwrap_or(source);
            let result = world.with_eval(&|| world.evaluate(js(source)?));
            Bun__Inspector__useConsole(world.realm, JSValue::UNDEFINED, false);
            result
        });
        Ok(evaluated(result??, wrapped.is_some()))
    }

    pub(super) fn check_syntax(&self, params: &Value) -> Outcome {
        require_interpreter()?;
        let realm = (self.world(&self.context(&params["executionContextId"])?)?).realm;
        let Some((message, line)) = syntax_error(realm, params["expression"].text()) else {
            return Ok(Value::empty());
        };
        Ok(record! { "exceptionDetails": record! {
            "exceptionId": 0,
            "text": "Uncaught",
            "lineNumber": line,
            "columnNumber": 0,
            "exception": record! {
                "type": "object",
                "subtype": "error",
                "className": "SyntaxError",
                "description": format!("SyntaxError: {message}"),
            },
        } })
    }

    pub(super) fn promise(&self, params: &Value) -> Result<Evaluated, Failure> {
        let found = self.objects.find(&params["promiseObjectId"])?;
        Ok(Evaluated {
            context: found.context,
            group: found.group,
            result: Ok(keep(found.value)),
            is_wrapped: false,
        })
    }

    pub(super) fn listeners(&self, params: &Value) -> Outcome {
        let found = self.objects.find(&params["objectId"])?;
        let (context, realm) = (&found.context, self.world(&found.context)?.realm);
        let describe = |it: &JSValue| {
            let member = |name| JsResult::Ok(it.get(realm, name)?.unwrap_or(JSValue::UNDEFINED));
            let handler =
                self.remote(member("listener")?, context, &found.group, Form::Reference)?;
            let [script, line, column] = place_of_function(member("listener")?);
            Ok(record! {
                "type": text_of(member("type")?)?,
                "useCapture": member("useCapture")?.to_boolean(),
                "passive": member("passive")?.to_boolean(),
                "once": member("once")?.to_boolean(),
                "scriptId": script.to_string(),
                "lineNumber": line,
                "columnNumber": column,
                "handler": &handler,
                "originalHandler": handler,
            })
        };
        let all = with_elements(self.listeners_of(found.value, context)?, |all| {
            all.iter().map(describe).collect::<JsResult<Value>>()
        })?;
        Ok(record! { "listeners": all })
    }

    pub(super) fn argument(&self, it: &Value, context: &Context) -> Result<JSValue, Failure> {
        let realm = self.world(context)?.realm;
        if !it["objectId"].is_nothing() {
            let found = self.objects.find_for_scripts(&it["objectId"])?;
            return match found.context.id == context.id {
                true => Ok(found.value),
                false => Err(
                    "Argument should belong to the same JavaScript world as target object".into(),
                ),
            };
        }
        let Some(text) = it["unserializableValue"].as_text() else {
            return Ok(match &it["value"] {
                Value::Undefined => JSValue::UNDEFINED,
                value => bun_core::String::clone_utf8(value.to_json().as_bytes())
                    .to_js_by_parse_json(realm)?,
            });
        };
        Ok(match text.strip_suffix('n') {
            Some(digits) => JSValue::big_int_from_decimal(global(), digits.as_bytes())?
                .ok_or("Failed to parse String to BigInt")?,
            None => JSValue::js_number(js(text)?.to_number(global())?),
        })
    }

    pub(super) fn call_function(&self, params: &Value) -> Result<Evaluated, Failure> {
        require_interpreter()?;
        let (this, context, group) = match &params["objectId"] {
            Value::Undefined => {
                let id = [&params["executionContextId"], &params["uniqueContextId"]];
                let context = self.context(id[usize::from(id[0].is_nothing())])?;
                (JSValue::UNDEFINED, context, group_in(params))
            }
            id => {
                let found = self.objects.find_for_scripts(id)?;
                let is_given = params["objectGroup"].is_truthy();
                let group = if is_given {
                    group_in(params)
                } else {
                    found.group
                };
                (found.value, found.context, group)
            }
        };
        let (world, arguments) = (self.world(&context)?, array(&[])?);
        for it in params["arguments"].items() {
            arguments.push(global(), self.argument(it, &context)?)?;
        }
        let source = format!("({})", params["functionDeclaration"].text());
        let result = world.with_eval(&|| {
            let function = world.evaluate(js(&*source)?)?;
            if !function.is_callable() {
                let message = "Given expression does not evaluate to a function";
                return Err(world.realm.throw_type_error(format_args!("{message}")));
            }
            with_elements(arguments, |it| function.call(world.realm, this, it))
        })?;
        Ok(Evaluated {
            context,
            group,
            result,
            is_wrapped: false,
        })
    }

    fn find_contexts(&self) -> JsResult<()> {
        self.context_named("")?;
        if self.document()?.has_world(OF_PRELOAD)? {
            self.context_named(PRELOAD_CONTEXT)?;
        }
        Ok(())
    }

    pub(super) fn enable(&self) -> JsResult<()> {
        if self.is_enabled.get() {
            return Ok(());
        }
        self.find_contexts()?;
        self.is_enabled.set(true);
        let contexts = self.contexts.borrow().clone();
        contexts.iter().try_for_each(|it| self.announce(it))?;
        let window = self.world_numbered(0)?.window;
        bun_web::dom::recall_log(window, &mut |it| task::report(self.logged(it)));
        Ok(())
    }

    pub(super) fn disable(&self) {
        self.is_enabled.set(false);
    }

    pub(super) fn discard_log(&self) -> JsResult<()> {
        self.objects.release_group(OF_CONSOLE);
        bun_web::dom::forget_log(self.world_numbered(0)?.window);
        Ok(())
    }

    pub(super) fn bind(&self, params: &Value) -> JsResult<()> {
        let context = self.context_named(params["executionContextName"].text())?;
        let name = params["name"].text();
        let (this, named, id) = (Weak::clone(&self.this), name.to_owned(), context.id);
        let world = self.world(&context)?;
        self.bindings.borrow_mut().push(name.into());
        let binding = function_in(
            world.realm,
            world.realm.to_js_value(),
            move |of_realm, arguments| {
                let params = record! {
                    "name": &*named,
                    "payload": text_in(realm::of(of_realm), argument(arguments, 0))?,
                    "executionContextId": id,
                };
                let this = (this.upgrade()).filter(|it| it.bindings.borrow().contains(&named));
                this.inspect(|it| (it.emit)("Runtime.bindingCalled", params));
                Ok(JSValue::UNDEFINED)
            },
        );
        assign(world.realm, world.window, js(name)?, binding)
    }

    pub(super) fn unbind(&self, name: &str) {
        self.bindings.borrow_mut().retain(|it| it != name);
    }

    pub(super) fn run_script(&self, script: &Value) -> JsResult<()> {
        let context = self.context_named(script["worldName"].text())?;
        match script["source"].text() {
            "" => Ok(()),
            _ if !can_evaluate()? => Ok(()),
            source => catch(self.world(&context)?.evaluate(js(source)?)).map(drop),
        }
    }

    pub(super) fn forget(&self) {
        self.objects.release_all();
        drop((
            self.helpers.take(),
            self.last_results.take(),
            self.selected.take(),
            self.contexts.take(),
            self.bindings.take(),
        ));
    }

    pub(super) fn logged(&self, it: Logged<'_>) -> JsResult<()> {
        if !self.is_enabled.get() {
            return Ok(());
        }
        let (context, group) = (self.context_of(realm::of(it.realm))?, Rc::from(OF_CONSOLE));
        if it.kind == "clear" {
            self.objects.release_group(OF_CONSOLE);
        }
        let form = if it.kind == "table" {
            Form::Table
        } else {
            Form::Preview
        };
        let trace = stack_trace(it.stack)?;
        if let ("exception", [text, error]) = (it.kind, it.values) {
            self.last_exception.update(|it| it + 1);
            let top = &trace["callFrames"][0];
            let details = top
                .pick(&["url", "lineNumber", "columnNumber"])
                .and(&record! {
                    "exceptionId": self.last_exception.get(),
                    "text": text_of(*text)?,
                    "exception": self.remote(*error, &context, &group, form)?,
                    "executionContextId": context.id,
                });
            let params = record! { "timestamp": it.time, "exceptionDetails": details };
            (self.emit)("Runtime.exceptionThrown", params);
            return Ok(());
        }
        let values = (it.values.iter()).map(|it| self.remote(*it, &context, &group, form));
        let params = record! {
            "type": it.kind,
            "args": values.collect::<JsResult<Value>>()?,
            "executionContextId": context.id,
            "timestamp": it.time,
            "stackTrace": trace,
        };
        (self.emit)("Runtime.consoleAPICalled", params);
        Ok(())
    }
}
