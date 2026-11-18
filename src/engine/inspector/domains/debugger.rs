use core::cell::RefCell;
use core::ops::Range;
use std::rc::Rc;

use bun_engine_text::StringRef;
use bun_engine_vm::{Cx, Vm};

use super::{Evaluation, parse_script_id};
use crate::Controller;
use crate::debugger::{Breakpoint, Location, Options, Position, Script, Step};
use crate::protocol::{Json, Object, Outcome, Params, Request, object};
use crate::remote::function_details;
use crate::search::{Matcher, Query, Syntax};

fn parse_location(json: &Object) -> Outcome<Location> {
    let line = json.integer("lineNumber");
    let line = line.ok_or("Unexpected non-integer lineNumber in given location")?;
    let script = json.string("scriptId");
    let script = script.ok_or("Unexepcted non-string scriptId in given location")?;
    let column = json.integer("columnNumber").unwrap_or(0);
    Ok(Location {
        script: parse_script_id(script),
        position: Position { line, column },
    })
}

/// Four numbers for each.
fn parse_ranges(numbers: &[Json]) -> Outcome<Vec<Range<Position>>> {
    let (ranges, []) = numbers.as_chunks::<4>() else {
        return Err("Unexpected format for given sourceRanges".into());
    };
    let number = |json: &Json| match json.as_integer() {
        None => Err("Unexpected non-integer item in given sourceRanges"),
        Some(..0) => Err("Unexpected negative item in given sourceRanges"),
        Some(number) => Ok(number),
    };
    let position = |line: &Json, column: &Json| {
        let (line, column) = (number(line)?, number(column)?);
        Outcome::Ok(Position { line, column })
    };
    let range = |[a, b, c, d]: &[Json; 4]| {
        let (start, end) = (position(a, b)?, position(c, d)?);
        if start.line > end.line {
            return Err("Unexpected endLine before startLine in given sourceRanges".into());
        }
        if start >= end {
            return Err("Unexpected endColumn before startColumn in given sourceRanges".into());
        }
        Ok(start..end)
    };
    ranges.iter().map(range).collect()
}

fn read_query(params: &Params<'_>, text: StringRef) -> Query {
    let is_case_sensitive = params.optional("caseSensitive");
    Query::new(text, is_case_sensitive, params.optional("isRegex"))
}

fn set_pause_on(slot: &RefCell<Option<Rc<Breakpoint>>>, params: &Params<'_>) -> Outcome<()> {
    let (is_enabled, options): (bool, _) = (params.required("enabled"), params.optional("options"));
    params.check()?;
    let breakpoint = is_enabled.then(|| Breakpoint::for_event(options));
    slot.replace(breakpoint.transpose()?);
    Ok(())
}

impl Controller {
    fn script_with_id(&self, id: &StringRef) -> Outcome<Rc<Script>> {
        let script = self.debugger.script(parse_script_id(id));
        Ok(script.ok_or("Missing script for given scriptId")?)
    }

    fn set_breakpoint_by_url(&self, vm: &Vm, params: &Params<'_>) -> Outcome {
        let line = params.required("lineNumber");
        let (url, regexp) = (params.optional("url"), params.optional("urlRegex"));
        let column = params.optional("columnNumber").unwrap_or(0);
        let options = params.optional("options");
        params.check()?;
        let is_regexp = regexp.is_some();
        let url = (url.xor(regexp)).ok_or("Either url or urlRegex must be specified")?;
        let (position, options) = (Position { line, column }, Options::parse(options)?);
        (self.debugger).set_breakpoint_by_url(vm, url, is_regexp, position, options)
    }

    fn set_breakpoint(&self, vm: &Vm, params: &Params<'_>) -> Outcome {
        let location = params.required_object("location");
        let options = params.optional("options");
        params.check()?;
        let location = parse_location(location)?;
        let script = (self.debugger.script(location.script))
            .ok_or("Missing script for scriptId in given location")?;
        let options = Options::parse(options)?;
        (self.debugger).set_breakpoint(vm, &script, location.position, options)
    }

    fn get_breakpoint_locations(&self, vm: &Vm, params: &Params<'_>) -> Outcome {
        let start = params.required_object("start");
        let end = params.required_object("end");
        params.check()?;
        let (start, end) = (parse_location(start)?, parse_location(end)?);
        if start.script != end.script {
            return Err("Must have same scriptId for given start and given end".into());
        }
        let (script, start, end) = (start.script, start.position, end.position);
        if (end.line as u32) < start.line as u32 {
            return Err(
                "Cannot have lineNumber of given end be before lineNumber of given start".into(),
            );
        }
        if start.line == end.line && (end.column as u32) < start.column as u32 {
            return Err(
                "Cannot have columnNumber of given end be before columnNumber of given start"
                    .into(),
            );
        }
        let script = self.debugger.script(script);
        let script = script.ok_or("Missing script for scriptId in given start")?;
        if script.is_webassembly() {
            return Err("WebAssembly breakpoints are not supported".into());
        }
        let locations = script.breakpoint_locations(vm, start..end).into_iter();
        Ok(object! { "locations": locations.map(Location::to_json).collect::<Vec<_>>() })
    }

    fn search_in_content(&self, vm: &Vm, params: &Params<'_>) -> Outcome {
        let script = params.required("scriptId");
        let query: StringRef = params.required("query");
        let is_case_sensitive = params.flag("caseSensitive");
        let syntax = match params.flag("isRegex") {
            true => Syntax::RegExp,
            false => Syntax::Part,
        };
        params.check()?;
        let script = self.script_with_id(&script)?;
        let matcher = Matcher::new(query.text(), syntax, is_case_sensitive);
        Ok(object! { "result": matcher.matching_lines(vm, script.source()) })
    }

    fn get_function_details(&self, cx: &Cx, params: &Params<'_>) -> Outcome {
        let id: StringRef = params.required("functionId");
        params.check()?;
        let (remote, id) = (self.remote_for(cx, id.text()))
            .ok_or("Missing injected script for given functionId")?;
        let function = remote.find(id.object).filter(|it| it.is_callable());
        let function = function.ok_or("Cannot resolve function by id.")?;
        let details = function.downcast().and_then(function_details);
        Ok(object! { "details": details.ok_or("Cannot resolve function details.")? })
    }

    fn set_pause_on_exceptions(&self, params: &Params<'_>) -> Outcome<()> {
        let state: StringRef = params.required("state");
        let options = params.optional("options");
        params.check()?;
        let [none, all, uncaught] = ["none", "all", "uncaught"].map(|it| state.text().eq_ascii(it));
        if !none && !all && !uncaught {
            return Err(format_args!("Unknown state: {state}").into());
        }
        let breakpoint = (!none).then(|| Breakpoint::for_event(options));
        let breakpoint = breakpoint.transpose()?;
        (self.debugger.on_all_exceptions).replace(breakpoint.clone().filter(|_| all));
        (self.debugger.on_uncaught_exceptions).replace(breakpoint.filter(|_| uncaught));
        Ok(())
    }

    fn set_should_blackbox_url(&self, vm: &Vm, params: &Params<'_>) -> Outcome<()> {
        let url: StringRef = params.required("url");
        let should_blackbox: bool = params.required("shouldBlackbox");
        let (is_empty, url) = (url.is_empty(), read_query(params, url));
        let ranges = params.optional("sourceRanges").unwrap_or_default();
        params.check()?;
        if is_empty {
            return Err("URL must not be empty".into());
        }
        let ranges = should_blackbox.then(|| parse_ranges(ranges)).transpose()?;
        self.debugger.set_blackbox(vm, url, ranges);
        Ok(())
    }

    fn dispatch_evaluate_on_call_frame(&self, cx: &mut Cx, params: &Params<'_>) -> Outcome {
        let id: StringRef = params.required("callFrameId");
        let evaluation = Evaluation::read(params, false)?;
        let (remote, id) = (self.remote_for(cx, id.text()))
            .ok_or("Missing injected script for given callFrameId")?;
        self.on_behalf_of_frontend(remote.enter(cx), |cx| {
            let (text, has_api) = (evaluation.expression, evaluation.has_api);
            self.evaluate_on_call_frame(cx, remote, id.frame, text, has_api, &evaluation.wanted)
        })
    }

    pub(crate) fn dispatch_debugger(
        &self,
        cx: &mut Cx,
        method: &str,
        request: &Request<'_>,
    ) -> Outcome<Option<Object>> {
        let (debugger, params) = (&self.debugger, &request.params);
        match method {
            "setBreakpointByUrl" => return self.set_breakpoint_by_url(cx, params).map(Some),
            "setBreakpoint" => return self.set_breakpoint(cx, params).map(Some),
            "getBreakpointLocations" => return self.get_breakpoint_locations(cx, params).map(Some),
            "searchInContent" => return self.search_in_content(cx, params).map(Some),
            "getFunctionDetails" => return self.get_function_details(cx, params).map(Some),
            "evaluateOnCallFrame" => {
                return self.dispatch_evaluate_on_call_frame(cx, params).map(Some);
            }
            "getScriptSource" => {
                let script = params.required("scriptId");
                params.check()?;
                let script = self.script_with_id(&script)?;
                return Ok(Some(object! { "scriptSource": script.source() }));
            }
            "enable" => self.enable_debugger(cx)?,
            "disable" => self.disable_debugger(cx),
            "setAsyncStackTraceDepth" => {
                let depth: i32 = params.required("depth");
                params.check()?;
                let depth = usize::try_from(depth).map_err(|_| "Unexpected negative depth")?;
                debugger.async_calls.set_depth(depth);
            }
            "setBreakpointsActive" => {
                let are_active = params.required("active");
                params.check()?;
                self.set_breakpoints_active(cx, are_active);
            }
            "removeBreakpoint" => {
                let id = params.required("breakpointId");
                params.check()?;
                self.remove_breakpoint(cx, &id);
            }
            "addSymbolicBreakpoint" => {
                let symbol = read_query(params, params.required("symbol"));
                let options = params.optional("options");
                params.check()?;
                debugger.add_symbolic_breakpoint(cx, symbol, Breakpoint::for_event(options)?)?;
            }
            "removeSymbolicBreakpoint" => {
                let symbol = read_query(params, params.required("symbol"));
                params.check()?;
                debugger.remove_symbolic_breakpoint(cx, &symbol)?;
            }
            "continueUntilNextRunLoop" => self.continue_until_next_run_loop(cx)?,
            "continueToLocation" => {
                let location = params.required_object("location");
                params.check()?;
                debugger.check_paused()?;
                self.continue_to_location(cx, parse_location(location)?)?;
            }
            "stepNext" => self.step(cx, Step::Next)?,
            "stepOver" => self.step(cx, Step::Over)?,
            "stepInto" => self.step(cx, Step::Into)?,
            "stepOut" => self.step(cx, Step::Out)?,
            "pause" => debugger.request_pause(cx),
            "resume" => debugger.resume(cx)?,
            "setPauseOnDebuggerStatements" => {
                set_pause_on(&debugger.on_debugger_statements, params)?;
            }
            "setPauseOnExceptions" => self.set_pause_on_exceptions(params)?,
            "setPauseOnAssertions" => set_pause_on(&debugger.on_assertions, params)?,
            "setPauseOnMicrotasks" => set_pause_on(&debugger.on_microtasks, params)?,
            "setPauseForInternalScripts" => {
                let _: bool = params.required("shouldPause");
                params.check()?;
            }
            "setShouldBlackboxURL" => self.set_should_blackbox_url(cx, params)?,
            "setBlackboxBreakpointEvaluations" => {
                let value = params.required("blackboxBreakpointEvaluations");
                params.check()?;
                debugger.set_blackboxes_evaluations(value);
            }
            _ => return Err(params.no_such_method()),
        }
        Ok(Some(object! {}))
    }
}
