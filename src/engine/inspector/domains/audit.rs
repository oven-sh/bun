use core::cell::RefCell;

use bun_engine_text::{Identifier, StringBuilder, StringRef};
use bun_engine_vm::{Attributes, Cx, Strong, Value};

use super::reject_context_id;
use crate::Controller;
use crate::protocol::{Object, Outcome, Request, object};
use crate::remote::{Detail, Wanted};

#[derive(Default)]
pub(crate) struct Audit {
    /// What tests get for an argument.
    object: RefCell<Option<Strong<Value>>>,
}

impl Audit {
    fn set_up(&self, cx: &Cx) {
        const VERSION: i32 = 4;
        let (object, name) = (cx.new_object(), Identifier::from_literal("Version"));
        object.put_direct(cx, name.name(), VERSION.into(), Attributes::NONE);
        self.object.replace(Some(Strong::new(cx, object.into())));
    }

    /// False if it was not set up.
    pub(crate) fn tear_down(&self) -> bool {
        self.object.take().is_some()
    }
}

impl Controller {
    fn run_audit(&self, cx: &mut Cx, test: &StringRef) -> Outcome {
        let mut script = StringBuilder::new();
        script.push_ascii("(function(WebInspectorAudit) { \"use strict\"; return eval(`(");
        for unit in test.text().code_units() {
            if unit == u16::from(b'`') {
                script.push_latin1(b'\\');
            }
            script.push_unit(unit);
        }
        script.push_ascii(")`)(WebInspectorAudit); })");
        let script = script.finish().map_err(|_| "Out of memory")?;
        let argument = (self.audit.object.borrow().as_ref()).map_or_default(|it| it.get(cx));
        let wanted = Wanted {
            group: StringRef::from_literal("audit"),
            by_value: false,
            detail: Detail::None,
            saves: false,
        };
        self.quietly(cx, |cx| {
            self.remote(cx).execute(cx, script, &[argument], &wanted)
        })
    }

    pub(crate) fn dispatch_audit(
        &self,
        cx: &mut Cx,
        method: &str,
        request: &Request<'_>,
    ) -> Outcome<Option<Object>> {
        let params = &request.params;
        match method {
            "setup" => {
                let context = params.optional("contextId");
                params.check()?;
                if self.audit.object.borrow().is_some() {
                    return Err("Must call teardown before calling setup again".into());
                }
                reject_context_id(context)?;
                self.audit.set_up(cx);
            }
            "run" => {
                let (test, context) = (params.required("test"), params.optional("contextId"));
                params.check()?;
                reject_context_id(context)?;
                return self.run_audit(cx, &test).map(Some);
            }
            "teardown" if self.audit.tear_down() => {}
            "teardown" => return Err("Must call setup before calling teardown".into()),
            _ => return Err(params.no_such_method()),
        }
        Ok(Some(object! {}))
    }
}
