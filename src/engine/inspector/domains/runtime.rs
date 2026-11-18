use core::cell::{Cell, RefCell};

use bun_engine_text::StringRef;
use bun_engine_vm::{CompileErrorKind, CompileErrorRecovery, Cx, SourceProvider, SourceType, Vm};

use super::{Evaluation, parse_script_id, reject_context_id};
use crate::Controller;
use crate::profiling::Coverage;
use crate::protocol::{Json, Object, Outcome, Params, Request, object};
use crate::remote::{Detail, ObjectId, Remote, Selection, Wanted, settle};

#[derive(Default)]
pub(crate) struct Runtime {
    saved_result_alias: RefCell<Option<StringRef>>,
    collects_coverage: Cell<bool>,
}

impl Runtime {
    /// What may stand for the `$` of `$1`.
    pub(crate) fn saved_result_alias(&self) -> Option<StringRef> {
        let alias = self.saved_result_alias.borrow().clone();
        alias.filter(|it| !it.is_empty())
    }

    pub(crate) fn set_collects_coverage(&self, vm: &Vm, collects: bool) {
        if self.collects_coverage.replace(collects) == collects {
            return;
        }
        vm.when_idle(move |vm| {
            let coverage = Coverage::of(vm);
            if (collects && coverage.enable(vm)) || (!collects && coverage.disable(vm)) {
                vm.discard_all_code();
            }
        });
    }
}

const INTERNAL_ERROR: &str = "Internal error";

fn parse(vm: &Vm, source: StringRef) -> Object {
    let provider = SourceProvider::build(source, None, SourceType::Program).finish();
    let error = vm.check_script_syntax(&provider).err();
    let Some(error) = error.filter(|it| it.kind == CompileErrorKind::Syntax) else {
        return object! { "result": "none" };
    };
    let result = match error.recovery {
        CompileErrorRecovery::Irrecoverable => "irrecoverable",
        CompileErrorRecovery::UnterminatedLiteral => "unterminated-literal",
        CompileErrorRecovery::Recoverable => "recoverable",
    };
    object! {
        "result": result,
        "message": error.message,
        "range": object! { "startOffset": error.token.start, "endOffset": error.token.end },
    }
}

fn basic_blocks(vm: &Vm, script: &StringRef) -> Outcome {
    if !vm.collects_coverage().get() {
        return Err("VM has no control flow information".into());
    }
    let blocks = Coverage::of(vm).blocks_and_code_ranges(parse_script_id(script));
    let blocks = blocks.iter().map(|block| {
        object! {
            "startOffset": block.start,
            "endOffset": block.end,
            "hasExecuted": block.has_executed,
            "executionCount": block.execution_count,
        }
    });
    Ok(object! { "basicBlocks": blocks.collect::<Vec<_>>() })
}

/// The first to fetch, and how many.
struct Window(Option<i32>, Option<i32>);

impl Window {
    fn read(params: &Params<'_>) -> Window {
        Window(params.optional("fetchStart"), params.optional("fetchCount"))
    }

    fn check(&self) -> Outcome<(usize, usize)> {
        let start = usize::try_from(self.0.unwrap_or(0));
        let count = usize::try_from(self.1.unwrap_or(0));
        Ok((
            start.map_err(|_| "fetchStart cannot be negative")?,
            count.map_err(|_| "fetchCount cannot be negative")?,
        ))
    }
}

impl Controller {
    fn remote_for_object(&self, vm: &Vm, id: &StringRef) -> Outcome<(Remote<'_>, ObjectId)> {
        let found = self.remote_for(vm, id.text());
        Ok(found.ok_or("Missing injected script for given objectId")?)
    }

    fn evaluate(&self, cx: &mut Cx, params: &Params<'_>) -> Outcome {
        let evaluation = Evaluation::read(params, true)?;
        reject_context_id(evaluation.context)?;
        let (remote, wanted) = (self.remote(cx), &evaluation.wanted);
        (self.debugger).ignoring_exceptions_if(evaluation.is_silent, || {
            self.on_behalf_of_frontend(cx, |cx| {
                remote.evaluate(cx, evaluation.expression, evaluation.has_api, wanted)
            })
        })
    }

    fn await_promise(&self, cx: &mut Cx, request: &Request<'_>) -> Outcome<()> {
        let params = &request.params;
        let id: StringRef = params.required("promiseObjectId");
        let by_value = params.flag("returnByValue");
        let detail = Detail::preview_if(params.flag("generatePreview"));
        let saves = params.flag("saveResult");
        params.check()?;
        let (remote, id) = (self.remote_for(cx, id.text()))
            .ok_or("Missing injected script for given promiseObjectId")?;
        let wanted = Wanted {
            group: remote.group_of(id.object),
            by_value,
            detail,
            saves,
        };
        remote.await_promise(remote.enter(cx), id.object, request.id, &wanted)
    }

    fn call_function_on(&self, cx: &mut Cx, request: &Request<'_>) -> Outcome<Option<Object>> {
        let params = &request.params;
        let id: StringRef = params.required("objectId");
        let declaration: StringRef = params.required("functionDeclaration");
        let arguments: &[Json] = params.optional("arguments").unwrap_or_default();
        let is_silent = params.flag("doNotPauseOnExceptionsAndMuteConsole");
        let by_value = params.flag("returnByValue");
        let detail = Detail::preview_if(params.flag("generatePreview"));
        params.flag("emulateUserGesture");
        let awaiting = params.flag("awaitPromise").then_some(request.id);
        params.check()?;
        let (remote, id) = self.remote_for_object(cx, &id)?;
        let wanted = Wanted {
            group: remote.group_of(id.object),
            by_value,
            detail,
            saves: false,
        };
        self.debugger.ignoring_exceptions_if(is_silent, || {
            self.on_behalf_of_frontend(remote.enter(cx), |cx| {
                let text = declaration.text();
                remote.call_function_on(cx, id.object, text, arguments, awaiting, &wanted)
            })
        })
    }

    fn get_preview(&self, cx: &mut Cx, params: &Params<'_>) -> Outcome {
        let id: StringRef = params.required("objectId");
        params.check()?;
        let (remote, id) = self.remote_for_object(cx, &id)?;
        let preview = self.quietly(remote.enter(cx), |cx| remote.preview_by_id(cx, id.object))?;
        Ok(object! { "preview": preview })
    }

    fn get_properties(&self, cx: &mut Cx, params: &Params<'_>, is_for_display: bool) -> Outcome {
        let id: StringRef = params.required("objectId");
        let selection = match !is_for_display && params.flag("ownProperties") {
            true => Selection::Own,
            false if is_for_display => Selection::Displayable,
            false => Selection::All,
        };
        let window = Window::read(params);
        let detail = Detail::preview_if(params.flag("generatePreview"));
        params.check()?;
        let (remote, id) = self.remote_for_object(cx, &id)?;
        let window = window.check()?;
        let result = self.quietly(remote.enter(cx), |cx| {
            let result = remote.properties(cx, id.object, selection, window, detail);
            settle(cx, result)
        });
        Ok(result.flatten().ok_or(INTERNAL_ERROR)?)
    }

    fn get_collection_entries(&self, cx: &mut Cx, params: &Params<'_>) -> Outcome {
        let id: StringRef = params.required("objectId");
        let group = params.optional("objectGroup");
        let window = Window::read(params);
        params.check()?;
        let (remote, id) = self.remote_for_object(cx, &id)?;
        let window = window.check()?;
        let entries = self.quietly(remote.enter(cx), |cx| {
            let entries = remote.collection_entries(cx, id.object, group, window);
            settle(cx, entries)
        });
        Ok(object! { "entries": entries.flatten().ok_or(INTERNAL_ERROR)? })
    }

    fn save_result(&self, cx: &mut Cx, params: &Params<'_>) -> Outcome {
        let argument = params.required_object("value");
        let context = params.optional("contextId");
        params.check()?;
        let remote = match argument.string("objectId") {
            Some(id) => self.remote_for_object(cx, id)?.0,
            None => {
                reject_context_id(context)?;
                self.remote(cx)
            }
        };
        let index = remote.save_argument(remote.enter(cx), argument);
        Ok(object! { "savedResultIndex": index })
    }

    pub(crate) fn dispatch_runtime(
        &self,
        cx: &mut Cx,
        method: &str,
        request: &Request<'_>,
    ) -> Outcome<Option<Object>> {
        let params = &request.params;
        match method {
            "evaluate" => return self.evaluate(cx, params).map(Some),
            "awaitPromise" => return self.await_promise(cx, request).map(|()| None),
            "callFunctionOn" => return self.call_function_on(cx, request),
            "getPreview" => return self.get_preview(cx, params).map(Some),
            "getProperties" => return self.get_properties(cx, params, false).map(Some),
            "getDisplayableProperties" => return self.get_properties(cx, params, true).map(Some),
            "getCollectionEntries" => return self.get_collection_entries(cx, params).map(Some),
            "saveResult" => return self.save_result(cx, params).map(Some),
            "parse" => {
                let source = params.required("source");
                params.check()?;
                return Ok(Some(parse(cx, source)));
            }
            "getBasicBlocks" => {
                let script = params.required("sourceID");
                params.check()?;
                return basic_blocks(cx, &script).map(Some);
            }
            "getRuntimeTypesForVariablesAtOffsets" => {
                let _: &[Json] = params.required("locations");
                params.check()?;
                return Err("VM has no type information".into());
            }
            "setSavedResultAlias" => {
                let alias = params.optional("alias");
                params.check()?;
                self.runtime.saved_result_alias.replace(alias);
            }
            "releaseObject" => {
                let id: StringRef = params.required("objectId");
                params.check()?;
                if let Some((remote, id)) = self.remote_for(cx, id.text()) {
                    remote.release(id.object);
                }
            }
            "releaseObjectGroup" => {
                let group = params.required("objectGroup");
                params.check()?;
                self.registries.release_group(cx, &group);
            }
            "enableControlFlowProfiler" => self.runtime.set_collects_coverage(cx, true),
            "disableControlFlowProfiler" => self.runtime.set_collects_coverage(cx, false),
            "enable" | "disable" | "enableTypeProfiler" | "disableTypeProfiler" => {}
            _ => return Err(params.no_such_method()),
        }
        Ok(Some(object! {}))
    }
}
