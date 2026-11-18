//! The domain `Runtime`.

use std::rc::Rc;

use bun_jsc::{StringJsc as _, Strong, from_js_host_call, from_js_host_call_generic};
use bun_ui::dom;

use super::contents::Contents;
use super::{Emit, Failure, Outcome, target_id_of};
use crate::prelude::*;
use crate::realm::{self, Realm};
use crate::renderer::World;
use crate::task;
use crate::value::{Value, number_to_string};

#[repr(C)]
struct EvalPolicy {
    allows: bool,
    watches: bool,
}

unsafe extern "C" {
    /// The name, whether it is enumerable, whether it is configurable and has a value, and that, for each.
    safe fn Bun__Desktop__ownProperties(realm: &Realm, object: JSValue) -> JSValue;
    safe fn Bun__Desktop__toStringTag(realm: &Realm, object: JSValue) -> JSValue;
    safe fn Bun__DesktopRealm__allowEval(realm: &Realm) -> EvalPolicy;
    safe fn Bun__DesktopRealm__restrictCode(
        realm: &Realm,
        allows_eval: bool,
        allows_web_assembly: bool,
        watches_eval: bool,
    );
    safe fn Bun__Desktop__set(realm: &Realm, object: JSValue, key: JSValue, value: JSValue);
}

const FIRST_WORLD: u32 = 1 << 20;

state!(fn last_context() -> Cell<u32>);

#[derive(Clone)]
pub(super) struct Context {
    pub(super) id: u32,
    name: Rc<str>,
}

type Evaluated = (Context, Result<Strong, Strong>);

type Settled = task::Receiver<Result<Strong, Strong>>;

struct Object {
    id: u32,
    value: Strong,
    context: Context,
}

pub(super) struct Runtime {
    contents: Contents,
    emit: Emit,
    contexts: RefCell<Vec<Context>>,
    objects: RefCell<Vec<Object>>,
    last_object: Cell<u32>,
    bindings: RefCell<Vec<String>>,
    is_enabled: Cell<bool>,
}

fn position(objects: &[Object], id: &Value) -> Option<usize> {
    let id = id.text().parse().ok()?;
    objects.binary_search_by_key(&id, |it| it.id).ok()
}

fn unserializable(kind: &str, text: &str) -> Value {
    record! { "type": kind, "unserializableValue": text, "description": text }
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

fn text_in(realm: &Realm, value: JSValue) -> JsResult<String> {
    Ok(string(&value.to_utf8(realm)?))
}

fn member_in(realm: &Realm, object: JSValue, name: &str) -> JsResult<String> {
    let member = object.get(realm, name)?;
    text_in(realm, member.unwrap_or(JSValue::UNDEFINED))
}

fn by_json(realm: &Realm, value: JSValue) -> JsResult<Value> {
    let json = value.json_stringify_fast(realm)?;
    Ok(Value::parse(&json.to_utf8()).unwrap_or_default())
}

impl Runtime {
    pub(super) fn new(contents: Contents, emit: Emit) -> Runtime {
        Runtime {
            contents,
            emit,
            contexts: RefCell::default(),
            objects: RefCell::default(),
            last_object: Cell::default(),
            bindings: RefCell::default(),
            is_enabled: Cell::default(),
        }
    }

    fn announce(&self, Context { id, name }: &Context) -> JsResult<()> {
        let context = record! {
            "id": *id,
            "name": &**name,
            "origin": self.contents.page().origin(),
            "uniqueId": id.to_string(),
            "auxData": record! {
                "isDefault": name.is_empty(),
                "type": if name.is_empty() { "default" } else { "isolated" },
                "frameId": &*target_id_of(self.contents.object()),
            },
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
        last_context().update(|it| it + 1);
        let context = Context {
            id: last_context().get(),
            name: name.into(),
        };
        self.contexts.borrow_mut().push(context.clone());
        if self.is_enabled.get() {
            self.announce(&context)?;
        }
        Ok(context)
    }

    pub(super) fn context(&self, id: &Value) -> Result<Context, Failure> {
        let Some(id) = id.as_number() else {
            return Ok(self.context_named("")?);
        };
        let contexts = self.contexts.borrow();
        let found = contexts.iter().find(|it| f64::from(it.id) == id);
        Ok(found
            .ok_or("Cannot find context with specified id")?
            .clone())
    }

    fn object(&self, id: &Value) -> Result<(JSValue, Context), Failure> {
        let objects = self.objects.borrow();
        let found = position(&objects, id).map(|at| &objects[at]);
        let found = found.ok_or("Could not find object with given id")?;
        Ok((found.value.get(), found.context.clone()))
    }

    fn world_numbered(&self, number: u32) -> JsResult<World> {
        self.contents.world(number)
    }

    fn world(&self, context: &Context) -> JsResult<World> {
        self.world_numbered(match context.name.is_empty() {
            true => 0,
            false => FIRST_WORLD + context.id,
        })
    }

    pub(super) fn object_in_page(&self, id: &Value) -> Result<JSValue, Failure> {
        let (value, context) = self.object(id)?;
        Ok((self.world(&context)?).carry(value, self.world_numbered(0)?)?)
    }

    pub(super) fn resolve(&self, node: JSValue, context: &Context) -> JsResult<Value> {
        let value = (self.world_numbered(0)?).carry(node, self.world(context)?)?;
        self.remote(value, context, false)
    }

    /// For what has come over the bridge.
    fn remote_of_page(&self, value: JSValue, context: &Context) -> JsResult<Value> {
        let value = realm::cross(self.world(context)?.realm, value)?;
        self.remote(value, context, false)
    }

    fn remote(&self, value: JSValue, context: &Context, is_by_value: bool) -> JsResult<Value> {
        if value.is_null() {
            return Ok(record! { "type": "object", "subtype": "null", "value": Value::Null });
        }
        let kind = string(&value.js_type_string(global()).to_utf8());
        match (&*kind, value.get_number()) {
            ("undefined", _) => return Ok(record! { "type": kind }),
            ("bigint", _) => return Ok(unserializable(&kind, &(text_of(value)? + "n"))),
            (_, Some(it)) if it == 0. && it.is_sign_negative() => {
                return Ok(unserializable(&kind, "-0"));
            }
            (_, Some(it)) if !it.is_finite() => {
                return Ok(unserializable(&kind, &number_to_string(it)));
            }
            ("number" | "string" | "boolean", _) => {
                return Ok(record! { "type": kind, "value": by_json(global(), value)? });
            }
            _ => {}
        }
        let world = self.world(context)?;
        if is_by_value {
            let copy = (kind == "object").then(|| by_json(world.realm, value));
            let copy = copy.transpose()?.unwrap_or_else(Value::empty);
            return Ok(record! { "type": kind, "value": copy });
        }
        self.last_object.update(|it| it + 1);
        let id = self.last_object.get();
        self.objects.borrow_mut().push(Object {
            id,
            value: keep(value),
            context: context.clone(),
        });
        let remote = record! { "type": &*kind, "objectId": id.to_string() };
        if kind != "object" {
            let description = match value.is_symbol() {
                true => format!(
                    "Symbol({})",
                    string(&value.get_description(global()).to_utf8())
                ),
                false => text_in(world.realm, value)?,
            };
            return Ok((remote.with("className", "Function")).with("description", description));
        }
        let class = text_of(from_js_host_call(world.realm, || {
            Bun__Desktop__toStringTag(world.realm, value)
        })?)?;
        let is_node = dom::Node(world.carry(value, self.world_numbered(0)?)?).is_one();
        let description = match &*class {
            "Error" => format!(
                "{}\n{}",
                text_in(world.realm, value)?,
                member_in(world.realm, value, "stack")?,
            ),
            "Array" => format!("Array({})", member_in(world.realm, value, "length")?),
            _ => class.clone(),
        };
        let subtype = match &*class {
            _ if is_node => Some("node".into()),
            "Array" | "Date" | "Error" | "Map" | "Promise" | "RegExp" | "Set" => {
                Some(class.to_ascii_lowercase())
            }
            _ => None,
        };
        Ok(remote.and(&record! {
            "subtype": subtype,
            "className": class,
            "description": description,
        }))
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

    pub(super) async fn result(&self, (context, result): Evaluated, params: &Value) -> Outcome {
        let result = match result {
            Ok(value) if params["awaitPromise"].is_truthy() => {
                let settled = self.settled(value.get(), &context)?;
                drop(value);
                settled.await.ok_or("Promise was collected")?
            }
            result => result,
        };
        self.context(&context.id.into())?;
        let is_by_value = params["returnByValue"].is_truthy();
        let thrown = match result {
            Ok(value) => match catch(self.remote(value.get(), &context, is_by_value))? {
                Ok(result) => return Ok(record! { "result": result }),
                Err(thrown) => thrown,
            },
            Err(thrown) => thrown.get(),
        };
        let exception = self.remote(thrown, &context, false)?;
        Ok(record! {
            "result": &exception,
            "exceptionDetails": record! {
                "exceptionId": 1,
                "text": "Uncaught",
                "lineNumber": 0,
                "columnNumber": 0,
                "exception": exception,
            },
        })
    }

    pub(super) fn evaluate(&self, params: &Value) -> Result<Evaluated, Failure> {
        let context = self.context(&params["contextId"])?;
        let world = self.world(&context)?;
        let result = world.with_eval(&|| world.evaluate(js(params["expression"].text())?))?;
        Ok((context, result))
    }

    fn argument(&self, it: &Value, realm: &Realm) -> Result<JSValue, Failure> {
        if !it["objectId"].is_nothing() {
            return Ok(self.object(&it["objectId"])?.0);
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
        let (this, context) = match &params["objectId"] {
            Value::Undefined => (
                JSValue::UNDEFINED,
                self.context(&params["executionContextId"])?,
            ),
            id => self.object(id)?,
        };
        let (world, arguments) = (self.world(&context)?, array(&[])?);
        for it in params["arguments"].items() {
            arguments.push(global(), self.argument(it, world.realm)?)?;
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
        Ok((context, result))
    }

    pub(super) fn properties(&self, params: &Value) -> Outcome {
        let (object, context) = self.object(&params["objectId"])?;
        let realm = self.world(&context)?.realm;
        let all = from_js_host_call(realm, || Bun__Desktop__ownProperties(realm, object))?;
        let describe = |[name, is_enumerable, is_configurable, has_value, value]: &[JSValue; 5]| {
            let value = (has_value.to_boolean()).then(|| self.remote(*value, &context, false));
            Ok(record! {
                "name": text_of(*name)?,
                "enumerable": is_enumerable.to_boolean(),
                "configurable": is_configurable.to_boolean(),
                "isOwn": true,
                "value": value.transpose()?,
            })
        };
        let result = with_elements(all, |all| {
            (all.as_chunks().0.iter().map(describe)).collect::<JsResult<Value>>()
        })?;
        Ok(record! { "result": result })
    }

    pub(super) fn release(&self, params: &Value) {
        let mut objects = self.objects.borrow_mut();
        if let Some(at) = position(&objects, &params["objectId"]) {
            objects.remove(at);
        }
    }

    pub(super) fn release_all(&self) {
        self.objects.take();
    }

    pub(super) fn enable(&self) -> JsResult<()> {
        if self.is_enabled.replace(true) {
            return Ok(());
        }
        let contexts = self.contexts.borrow().clone();
        contexts.iter().try_for_each(|it| self.announce(it))
    }

    fn bind(&self, name: &str) -> JsResult<()> {
        let context = self.context_named("")?;
        let (emit, named, id) = (Rc::clone(&self.emit), name.to_owned(), context.id);
        let world = self.world(&context)?;
        let binding = function_in(
            world.realm,
            world.realm.to_js_value(),
            move |of_realm, arguments| {
                let params = record! {
                    "name": &*named,
                    "payload": text_in(realm::of(of_realm), argument(arguments, 0))?,
                    "executionContextId": id,
                };
                emit("Runtime.bindingCalled", params);
                Ok(JSValue::UNDEFINED)
            },
        );
        let name = js(name)?;
        from_js_host_call_generic(world.realm, || {
            Bun__Desktop__set(world.realm, world.window, name, binding)
        })
    }

    pub(super) fn add_binding(&self, name: &str) -> JsResult<()> {
        if !self.bindings.borrow().iter().any(|it| it == name) {
            self.bindings.borrow_mut().push(name.into());
        }
        self.bind(name)
    }

    pub(super) fn run_script(&self, script: &Value) -> JsResult<()> {
        let context = self.context_named(script["worldName"].text())?;
        match script["source"].text() {
            "" => Ok(()),
            source => catch(self.world(&context)?.evaluate(js(source)?)).map(drop),
        }
    }

    pub(super) fn forget_document(&self) {
        self.release_all();
        self.contexts.take();
        (self.emit)("Runtime.executionContextsCleared", Value::empty());
    }

    pub(super) fn enter_document(&self) -> JsResult<()> {
        self.context_named("")?;
        let bindings = self.bindings.borrow().clone();
        bindings.iter().try_for_each(|it| self.bind(it))
    }

    pub(super) fn logged(&self, kind: &str, values: &[JSValue]) -> JsResult<()> {
        if self.is_enabled.get() {
            let context = self.context_named("")?;
            let values = values.iter().map(|it| self.remote_of_page(*it, &context));
            let params = record! {
                "type": kind,
                "args": values.collect::<JsResult<Value>>()?,
                "executionContextId": context.id,
                "timestamp": bun_web::time::wall_now() * 1e3,
            };
            (self.emit)("Runtime.consoleAPICalled", params);
        }
        Ok(())
    }

    pub(super) fn thrown(&self, details: Value, error: JSValue) -> JsResult<()> {
        if self.is_enabled.get() {
            let exception = self.remote_of_page(error, &self.context_named("")?)?;
            let params = record! {
                "timestamp": bun_web::time::wall_now() * 1e3,
                "exceptionDetails": details.with("exception", exception),
            };
            (self.emit)("Runtime.exceptionThrown", params);
        }
        Ok(())
    }
}
