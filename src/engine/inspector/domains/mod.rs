//! The commands of each domain. One returns `None` if its response is yet to come.

mod audit;
mod console;
mod debugger;
mod heap;
mod runtime;
mod script_profiler;

pub(crate) use audit::Audit;
pub(crate) use console::Console;
pub(crate) use heap::Heap;
pub(crate) use runtime::Runtime;
pub use script_profiler::ProfilingReason;
pub(crate) use script_profiler::ScriptProfiler;

use bun_engine_number::{Radix, Surroundings, parse_integer};
use bun_engine_text::StringRef;

use crate::protocol::{Outcome, Params};
use crate::remote::{Detail, Wanted};

/// Zero, which no script has, if it is no number.
fn parse_script_id(id: &StringRef) -> usize {
    let surroundings = Surroundings::WhiteSpaceBeforeAnythingAfter;
    parse_integer(id.text(), Radix::DECIMAL, surroundings).unwrap_or(0)
}

fn reject_context_id(id: Option<i32>) -> Outcome<()> {
    if id.is_some() {
        return Err("executionContextId is not supported for JSContexts as there is only one execution context".into());
    }
    Ok(())
}

/// What `Runtime.evaluate` and `Debugger.evaluateOnCallFrame` have in common.
struct Evaluation {
    expression: StringRef,
    has_api: bool,
    is_silent: bool,
    context: Option<i32>,
    wanted: Wanted,
}

impl Evaluation {
    fn read(params: &Params<'_>, takes_context: bool) -> Outcome<Evaluation> {
        let expression = params.required("expression");
        let group = params.optional("objectGroup").unwrap_or_default();
        let has_api = params.flag("includeCommandLineAPI");
        let is_silent = params.flag("doNotPauseOnExceptionsAndMuteConsole");
        let context = takes_context.then(|| params.optional("contextId"));
        let wanted = Wanted {
            group,
            by_value: params.flag("returnByValue"),
            detail: Detail::preview_if(params.flag("generatePreview")),
            saves: params.flag("saveResult"),
        };
        params.flag("emulateUserGesture");
        params.check()?;
        Ok(Evaluation {
            expression,
            has_api,
            is_silent,
            context: context.flatten(),
            wanted,
        })
    }
}
