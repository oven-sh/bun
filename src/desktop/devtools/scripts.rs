//! The domain `Debugger`.

use core::ffi::c_void;
use core::ops::ControlFlow;
use core::ptr::NonNull;
use std::rc::{Rc, Weak};

use bun_jsc::from_js_host_call;
use bun_web::exec::pause_pages;

use super::mirror::{Form, Role};
use super::runtime::{Context, Evaluated, Runtime, assign};
use super::{Emit, Failure, Outcome, pure};
use crate::prelude::*;
use crate::realm::Realm;
use crate::value::Value;
use crate::{task, text};

#[repr(C)]
struct Parsed {
    id: u32,
    start: [u32; 2],
    end: [u32; 2],
    length: u32,
    is_module: bool,
    has_failed: bool,
    url: bun_core::String,
    directive: bun_core::String,
    map: bun_core::String,
}

#[repr(C)]
struct Client {
    context: *const c_void,
    parsed: unsafe extern "C" fn(*const c_void, &Realm, &Parsed),
    paused: unsafe extern "C" fn(*const c_void, &Realm, JSValue, u32),
}

#[repr(u8)]
#[derive(Clone, Copy)]
enum Command {
    Activate,
    Deactivate,
    Pause,
    Resume,
    StepInto,
    StepOver,
    StepOut,
    SkipPauses,
    TakePauses,
    IgnoreExceptions,
    PauseOnUncaught,
    PauseOnAll,
}

bun_opaque::opaque_ffi! {
    struct Native;
}

unsafe extern "C" {
    safe fn Bun__Inspector__matches(
        pattern: &bun_core::String,
        text: &bun_core::String,
        is_exact: bool,
    ) -> bool;
    safe fn Bun__Debugger__create(global: &Realm) -> Option<NonNull<Native>>;
    fn Bun__Debugger__destroy(it: NonNull<Native>);
    fn Bun__Debugger__follow(it: &Native, realm: &Realm, client: Client) -> bool;
    safe fn Bun__Debugger__leaveAll(it: &Native);
    safe fn Bun__Debugger__command(it: &Native, command: Command);
    safe fn Bun__Debugger__source(it: &Native, script: u32, source: &mut bun_core::String) -> bool;
    safe fn Bun__Debugger__setBreakpoint(
        it: &Native,
        id: u32,
        condition: &bun_core::String,
        place: &mut [u32; 3],
    ) -> bool;
    safe fn Bun__Debugger__removeBreakpoint(it: &Native, id: u32);
    safe fn Bun__Debugger__possibleBreakpoints(
        it: &Native,
        global: &Realm,
        script: u32,
        range: &[u32; 4],
    ) -> JSValue;
    safe fn Bun__Debugger__ignore(it: &Native, script: u32, is_ignored: bool);
    safe fn Bun__Debugger__frames(it: &Native, global: &Realm) -> JSValue;
    safe fn Bun__Debugger__realmOfFrame(it: &Native, index: u32) -> Option<&Realm>;
    safe fn Bun__Debugger__evaluate(
        it: &Native,
        realm: &Realm,
        index: u32,
        source: &bun_core::String,
        helpers: JSValue,
    ) -> JSValue;
}

const BACKTRACE: &str = "backtrace";
/// For `Debugger.continueToLocation`
const TEMPORARY: u32 = 1;

struct Script {
    id: u32,
    url: String,
    hash: String,
}

enum Scope {
    Url(String),
    Pattern(String),
    Hash(String),
    Script(u32),
}

struct Breakpoint {
    number: u32,
    id: String,
    scope: Scope,
    place: [u32; 2],
    condition: String,
}

fn matches(pattern: &str, text: &str, is_exact: bool) -> bool {
    let [pattern, text] = [pattern, text].map(|it| bun_core::String::clone_utf8(it.as_bytes()));
    Bun__Inspector__matches(&pattern, &text, is_exact)
}

impl Scope {
    fn has(&self, script: &Script) -> bool {
        match self {
            Scope::Url(url) => script.url == *url,
            Scope::Pattern(pattern) => matches(pattern, &script.url, true),
            Scope::Hash(hash) => script.hash == *hash,
            Scope::Script(id) => script.id == *id,
        }
    }
}

fn location([script, line, column]: [u32; 3]) -> Value {
    record! { "scriptId": script.to_string(), "lineNumber": line, "columnNumber": column }
}

fn script_in(params: &Value) -> u32 {
    params["scriptId"].text().parse().unwrap_or(0)
}

fn line_and_column(params: &Value) -> [u32; 2] {
    ["lineNumber", "columnNumber"].map(|it| params[it].as_number().unwrap_or(0.0) as u32)
}

pub(super) struct Debugger {
    this: Weak<Debugger>,
    native: NonNull<Native>,
    runtime: Rc<Runtime>,
    emit: Emit,
    scripts: RefCell<Vec<Script>>,
    breakpoints: RefCell<Vec<Breakpoint>>,
    last_breakpoint: Cell<u32>,
    ignored: RefCell<Vec<String>>,
    ignores_anonymous: Cell<bool>,
    are_breakpoints_active: Cell<bool>,
    /// While it is paused.
    resume: Cell<Option<task::Sender<()>>>,
}

impl Drop for Debugger {
    fn drop(&mut self) {
        // SAFETY: nothing else has it.
        unsafe { Bun__Debugger__destroy(self.native) };
    }
}

unsafe extern "C" fn parsed(context: *const c_void, realm: &Realm, script: &Parsed) {
    // SAFETY: it owns who calls.
    let debugger = unsafe { &*context.cast::<Debugger>() }.this.upgrade();
    debugger.inspect(|it| task::report(it.parsed(realm, script)));
}

unsafe extern "C" fn paused(context: *const c_void, _: &Realm, thrown: JSValue, breakpoint: u32) {
    // SAFETY: it owns who calls.
    let debugger = unsafe { &*context.cast::<Debugger>() }.this.upgrade();
    debugger.inspect(|it| task::report(it.pause(thrown, breakpoint)));
}

impl Debugger {
    pub(super) fn new(runtime: Rc<Runtime>, emit: Emit) -> Result<Rc<Debugger>, Failure> {
        let native = Bun__Debugger__create(global()).ok_or("This program has no debugger")?;
        Ok(Rc::new_cyclic(|this| Debugger {
            this: Weak::clone(this),
            native,
            runtime,
            emit,
            scripts: RefCell::default(),
            breakpoints: RefCell::default(),
            last_breakpoint: Cell::new(TEMPORARY),
            ignored: RefCell::default(),
            ignores_anonymous: Cell::default(),
            are_breakpoints_active: Cell::new(true),
            resume: Cell::default(),
        }))
    }

    fn native(&self) -> &Native {
        // SAFETY: it lives as long as this does.
        unsafe { self.native.as_ref() }
    }

    fn command(&self, command: Command) {
        Bun__Debugger__command(self.native(), command);
    }

    pub(super) fn enter_document(&self) -> Result<(), Failure> {
        for context in self.runtime.contexts()? {
            let client = Client {
                context: core::ptr::from_ref(self).cast(),
                parsed,
                paused,
            };
            let realm = self.runtime.world(&context)?.realm;
            // SAFETY: what has the pointer does not outlive this.
            if !unsafe { Bun__Debugger__follow(self.native(), realm, client) } {
                return Err("Another debugger is attached to the page".into());
            }
        }
        self.command(Command::Activate);
        Ok(())
    }

    pub(super) fn close(&self) {
        drop(self.resume.take());
        self.command(Command::Deactivate);
        Bun__Debugger__leaveAll(self.native());
    }

    fn source(&self, script: u32) -> Option<bun_core::String> {
        let mut source = bun_core::String::EMPTY;
        Bun__Debugger__source(self.native(), script, &mut source).then_some(source)
    }

    fn is_ignored(&self, script: &Script) -> bool {
        match script.url.is_empty() {
            true => self.ignores_anonymous.get(),
            false => (self.ignored.borrow().iter()).any(|it| matches(it, &script.url, false)),
        }
    }

    fn parsed(&self, realm: &Realm, parsed: &Parsed) -> JsResult<()> {
        let [url, directive, map] =
            [&parsed.url, &parsed.directive, &parsed.map].map(|it| string(&it.to_utf8()));
        let source = self.source(parsed.id).unwrap_or(bun_core::String::EMPTY);
        let script = Script {
            id: parsed.id,
            url: if directive.is_empty() {
                url.clone()
            } else {
                directive.clone()
            },
            hash: format!("{:016x}", bun_wyhash::hash(&source.to_utf8())),
        };
        let params = record! {
            "scriptId": script.id.to_string(),
            "url": &*script.url,
            "startLine": parsed.start[0],
            "startColumn": parsed.start[1],
            "endLine": parsed.end[0],
            "endColumn": parsed.end[1],
            "hash": &*script.hash,
            "buildId": "",
            "sourceMapURL": map,
            "hasSourceURL": !directive.is_empty(),
            "isModule": parsed.is_module,
            "length": parsed.length,
            "scriptLanguage": "JavaScript",
            "embedderName": url,
        };
        let params = params.and(&self.runtime.about_context_of(realm)?);
        if parsed.has_failed {
            (self.emit)("Debugger.scriptFailedToParse", params);
            return Ok(());
        }
        Bun__Debugger__ignore(self.native(), script.id, self.is_ignored(&script));
        let resolved = (self.breakpoints.borrow().iter())
            .filter_map(|it| {
                let place = location(self.resolve(it, &script)?);
                Some(record! { "breakpointId": &*it.id, "location": place })
            })
            .collect::<Vec<_>>();
        self.scripts.borrow_mut().push(script);
        (self.emit)("Debugger.scriptParsed", params);
        for it in resolved {
            (self.emit)("Debugger.breakpointResolved", it);
        }
        Ok(())
    }

    fn resolve(&self, breakpoint: &Breakpoint, script: &Script) -> Option<[u32; 3]> {
        let mut place = [script.id, breakpoint.place[0], breakpoint.place[1]];
        let condition = bun_core::String::clone_utf8(breakpoint.condition.as_bytes());
        (breakpoint.scope.has(script)
            && Bun__Debugger__setBreakpoint(
                self.native(),
                breakpoint.number,
                &condition,
                &mut place,
            ))
        .then_some(place)
    }

    /// Its id, and where it has come to be.
    fn set_breakpoint(
        &self,
        scope: Scope,
        place: [u32; 2],
        condition: &Value,
    ) -> Result<(String, Vec<Value>), Failure> {
        let (kind, name) = match &scope {
            Scope::Url(url) => (1, url.clone()),
            Scope::Pattern(pattern) => (2, pattern.clone()),
            Scope::Hash(hash) => (3, hash.clone()),
            Scope::Script(id) => (4, id.to_string()),
        };
        let id = format!("{kind}:{}:{}:{name}", place[0], place[1]);
        if self.breakpoints.borrow().iter().any(|it| it.id == id) {
            return Err("Breakpoint at specified location already exists.".into());
        }
        self.last_breakpoint.update(|it| it + 1);
        let breakpoint = Breakpoint {
            number: self.last_breakpoint.get(),
            id: id.clone(),
            scope,
            place,
            condition: condition.text().into(),
        };
        let places = (self.scripts.borrow().iter())
            .filter_map(|it| self.resolve(&breakpoint, it).map(location))
            .collect();
        self.breakpoints.borrow_mut().push(breakpoint);
        Ok((id, places))
    }

    fn set_breakpoint_by_url(&self, params: &Value) -> Outcome {
        let text = |name: &str| params[name].as_text().map(str::to_owned);
        let scope = (text("urlRegex").map(Scope::Pattern))
            .or_else(|| text("url").map(Scope::Url))
            .or_else(|| text("scriptHash").map(Scope::Hash))
            .ok_or("Either url or urlRegex or scriptHash must be specified.")?;
        let (id, places) =
            self.set_breakpoint(scope, line_and_column(params), &params["condition"])?;
        Ok(record! { "breakpointId": id, "locations": Value::List(places) })
    }

    fn set_breakpoint_in_script(&self, params: &Value) -> Outcome {
        let place = &params["location"];
        let scope = Scope::Script(script_in(place));
        let (id, mut places) =
            self.set_breakpoint(scope, line_and_column(place), &params["condition"])?;
        let Some(place) = places.pop() else {
            self.breakpoints.borrow_mut().pop();
            return Err("Could not resolve breakpoint".into());
        };
        Ok(record! { "breakpointId": id, "actualLocation": place })
    }

    fn remove_breakpoint(&self, id: &Value) {
        let mut all = self.breakpoints.borrow_mut();
        for it in all.extract_if(.., |it| id.is(&it.id)) {
            Bun__Debugger__removeBreakpoint(self.native(), it.number);
        }
    }

    fn possible_breakpoints(&self, params: &Value) -> Outcome {
        let (script, start) = (
            script_in(&params["start"]),
            line_and_column(&params["start"]),
        );
        let end = Some(&params["end"]).filter(|it| it.is_truthy());
        let end = end.map_or([u32::MAX; 2], line_and_column);
        let range = [start[0], start[1], end[0], end[1]];
        let all = from_js_host_call(global(), || {
            Bun__Debugger__possibleBreakpoints(self.native(), global(), script, &range)
        })?;
        let places = with_elements(all, |all| {
            let place = |it: &[JSValue; 2]| location([script, it[0].to_u32(), it[1].to_u32()]);
            Ok(all.as_chunks().0.iter().map(place).collect::<Value>())
        })?;
        Ok(record! { "locations": places })
    }

    fn search(&self, params: &Value) -> Outcome {
        let source = self.source(script_in(params)).ok_or("No script for id")?;
        Ok(record! { "result": search(&string(&source.to_utf8()), params) })
    }

    fn ignore(&self, params: &Value) {
        let patterns = params["patterns"]
            .items()
            .iter()
            .map(|it| it.text().to_owned());
        self.ignored.replace(patterns.collect());
        (self.ignores_anonymous).set(params["skipAnonymous"].is_truthy());
        for script in &*self.scripts.borrow() {
            Bun__Debugger__ignore(self.native(), script.id, self.is_ignored(script));
        }
    }

    fn context_of_frame(&self, index: u32) -> Result<Context, Failure> {
        let realm = Bun__Debugger__realmOfFrame(self.native(), index);
        let realm = realm.ok_or("Could not find call frame with given id")?;
        Ok(self.runtime.context_of(realm)?)
    }

    fn raw_frames(&self) -> JsResult<JSValue> {
        from_js_host_call(global(), || Bun__Debugger__frames(self.native(), global()))
    }

    fn frames(&self) -> Outcome {
        let group = Rc::from(BACKTRACE);
        let describe = |(index, frame): (usize, &[JSValue; 6])| {
            let [function, script, line, column, this, scopes] = *frame;
            let context = self.context_of_frame(index as u32)?;
            let remote =
                |role, it| (self.runtime).remote_as(role, it, &context, &group, Form::Reference);
            let scope = |&[kind, name, object]: &[JSValue; 3]| {
                let (kind, name) = (text_of(kind)?, text_of(name)?);
                let object = match &*kind {
                    "global" => remote(Role::Itself, self.runtime.world(&context)?.window)?,
                    _ => remote(Role::Scope, object)?,
                };
                let name = Some(name).filter(|it| !it.is_empty());
                Ok(record! { "type": kind, "name": name, "object": object })
            };
            let scopes = with_elements(scopes, |all| {
                (all.as_chunks().0.iter().map(scope)).collect::<JsResult<Value>>()
            })?;
            Ok(record! {
                "callFrameId": index.to_string(),
                "functionName": text_of(function)?,
                "location": location([script, line, column].map(JSValue::to_u32)),
                "url": "",
                "scopeChain": scopes,
                "this": remote(Role::Itself, this)?,
                "canBeRestarted": false,
            })
        };
        with_elements(self.raw_frames()?, |all| {
            Ok(all
                .as_chunks()
                .0
                .iter()
                .enumerate()
                .map(describe)
                .collect::<Outcome>())
        })?
    }

    fn pause(&self, thrown: JSValue, breakpoint: u32) -> JsResult<()> {
        Bun__Debugger__removeBreakpoint(self.native(), TEMPORARY);
        let hit = (self.breakpoints.borrow().iter())
            .find_map(|it| (it.number == breakpoint).then(|| it.id.clone()));
        if !self.are_breakpoints_active.get() && hit.is_some() {
            return Ok(());
        }
        let (Ok(frames), Ok(context)) = (self.frames(), self.context_of_frame(0)) else {
            return Ok(());
        };
        let data = (!thrown.is_empty())
            .then(|| (self.runtime).remote(thrown, &context, &BACKTRACE.into(), Form::Preview));
        let params = record! {
            "callFrames": frames,
            "reason": if data.is_some() { "exception" } else { "other" },
            "data": data.transpose()?,
            "hitBreakpoints": hit.into_iter().map(Value::from).collect::<Value>(),
        };
        let (resume, resumed) = task::oneshot();
        self.resume.set(Some(resume));
        (self.emit)("Debugger.paused", params);
        pause_pages(global(), resumed);
        self.runtime.objects.release_group(BACKTRACE);
        (self.emit)("Debugger.resumed", Value::empty());
        Ok(())
    }

    fn go_on(&self, command: Command) -> Outcome {
        let resume = self.resume.take();
        let resume = resume.ok_or("Can only perform operation while paused.")?;
        self.command(command);
        resume.send(());
        Ok(Value::empty())
    }

    fn continue_to(&self, place: &Value) -> Outcome {
        let [line, column] = line_and_column(place);
        let mut place = [script_in(place), line, column];
        let always = bun_core::String::EMPTY;
        Bun__Debugger__setBreakpoint(self.native(), TEMPORARY, &always, &mut place);
        self.go_on(Command::Resume)
    }

    /// It continues if the name is left to the global scope.
    fn variable(
        &self,
        realm: &Realm,
        index: u32,
        name: &str,
    ) -> JsResult<ControlFlow<Option<JSValue>>> {
        with_elements(self.raw_frames()?, |all| {
            let Some(frame) = all.as_chunks::<6>().0.get(index as usize) else {
                return Ok(ControlFlow::Break(None));
            };
            if name == "this" {
                return Ok(ControlFlow::Break(Some(frame[4])));
            }
            with_elements(frame[5], |scopes| {
                for &[kind, _, scope] in scopes.as_chunks().0 {
                    match &*text_of(kind)? {
                        "with" => return Ok(ControlFlow::Break(None)),
                        "script" | "global" => break,
                        _ => {}
                    }
                    let find = |parts: &[JSValue]| {
                        Ok(parts
                            .iter()
                            .find_map(|it| pure::variable_in(realm, *it, name)))
                    };
                    if let found @ Some(_) = with_elements(scope, find)? {
                        return Ok(ControlFlow::Break(found));
                    }
                }
                Ok(ControlFlow::Continue(()))
            })
        })
    }

    pub(super) fn evaluate(&self, params: &Value) -> Result<Evaluated, Failure> {
        let index = params["callFrameId"].text().parse().unwrap_or(u32::MAX);
        let (context, source) = (self.context_of_frame(index)?, params["expression"].text());
        let realm = self.runtime.world(&context)?.realm;
        let result = if params["throwOnSideEffect"].is_truthy() {
            let local = |name: &str| {
                (self.variable(realm, index, name)).unwrap_or(ControlFlow::Break(None))
            };
            self.runtime.evaluate_purely(&context, source, &local)?
        } else {
            let source = bun_core::String::clone_utf8(source.as_bytes());
            let result = self.runtime.with_helpers(&context, params, |helpers| {
                from_js_host_call(realm, || {
                    Bun__Debugger__evaluate(self.native(), realm, index, &source, helpers)
                })
            });
            catch(result?)?.map(keep).map_err(keep)
        };
        Ok(Evaluated {
            context,
            group: params["objectGroup"].text().into(),
            result,
            is_wrapped: false,
        })
    }

    fn set_variable(&self, params: &Value) -> Outcome {
        let index = params["callFrameId"].text().parse().unwrap_or(u32::MAX);
        let context = self.context_of_frame(index)?;
        let realm = self.runtime.world(&context)?.realm;
        let value = self.runtime.argument(&params["newValue"], &context)?;
        let scopes = self.raw_frames()?.get_index(global(), index * 6 + 5)?;
        let number = u32::from(params["scopeNumber"].number() as u16);
        let scope = scopes.get_index(global(), number * 3 + 2)?;
        if !scope.is_object() {
            return Err("Could not find scope with given number".into());
        }
        let name = params["variableName"].text();
        let holder = with_elements(scope, |parts| {
            Ok(parts
                .iter()
                .copied()
                .find(|it| pure::variable_in(realm, *it, name).is_some()))
        })?;
        assign(
            realm,
            holder.ok_or("Could not find the variable")?,
            js(name)?,
            value,
        )?;
        Ok(Value::empty())
    }

    /// `None` for what it does not know.
    pub(super) fn run(&self, method: &str, params: &Value) -> Option<Outcome> {
        let command = |it| {
            self.command(it);
            Ok(Value::empty())
        };
        Some(match text::split_once(method, ".")?.1 {
            "continueToLocation" => self.continue_to(&params["location"]),
            "getPossibleBreakpoints" => self.possible_breakpoints(params),
            "getScriptSource" => match self.source(script_in(params)) {
                Some(it) => Ok(record! { "scriptSource": string(&it.to_utf8()) }),
                None => Err(Failure(format!(
                    "No script for id: {}",
                    params["scriptId"].text()
                ))),
            },
            "pause" => command(Command::Pause),
            "removeBreakpoint" => {
                self.remove_breakpoint(&params["breakpointId"]);
                Ok(Value::empty())
            }
            "resume" => self.go_on(Command::Resume),
            "searchInContent" => self.search(params),
            "setBlackboxPatterns" => {
                self.ignore(params);
                Ok(Value::empty())
            }
            "setBreakpoint" => self.set_breakpoint_in_script(params),
            "setBreakpointByUrl" => self.set_breakpoint_by_url(params),
            "setBreakpointsActive" => {
                (self.are_breakpoints_active).set(params["active"].is_truthy());
                Ok(Value::empty())
            }
            "setPauseOnExceptions" => command(match params["state"].text() {
                "none" => Command::IgnoreExceptions,
                "uncaught" => Command::PauseOnUncaught,
                _ => Command::PauseOnAll,
            }),
            "setSkipAllPauses" => command(match params["skip"].is_truthy() {
                true => Command::SkipPauses,
                false => Command::TakePauses,
            }),
            "setVariableValue" => self.set_variable(params),
            "stepInto" => self.go_on(Command::StepInto),
            "stepOut" => self.go_on(Command::StepOut),
            "stepOver" => self.go_on(Command::StepOver),
            _ => return None,
        })
    }
}

/// The lines of `source` that have what `params` asks for.
pub(super) fn search(source: &str, params: &Value) -> Value {
    let (query, is_exact) = (params["query"].text(), params["caseSensitive"].is_truthy());
    let fold = |it: &str| {
        if is_exact {
            it.to_owned()
        } else {
            it.to_lowercase()
        }
    };
    let (is_pattern, folded) = (params["isRegex"].is_truthy(), fold(query));
    let has = |line: &str| match is_pattern {
        true => matches(query, line, is_exact),
        false => text::contains(&fold(line), &folded),
    };
    (text::split(source, "\n").enumerate().filter(|it| has(it.1)))
        .map(|(number, line)| record! { "lineNumber": number as u32, "lineContent": line })
        .collect()
}
