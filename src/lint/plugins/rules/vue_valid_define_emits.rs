use crate::oxlint::vue::{DefineMacroProblem, calls_of, check_define_macro_call_expression, is_vue_setup};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce valid usage of the `defineEmits` compiler macro in Vue.
pub struct ValidDefineEmits;

const HAS_TYPE_AND_ARGUMENTS: Message = Message::new("", "`defineEmits` has both a type-only emit and an argument.");
const CALLED_MULTIPLE_TIMES: Message = Message::new("", "`defineEmits` has been called multiple times.");
const EVENTS_NOT_DEFINED: Message = Message::new("", "Custom events are not defined.");
const REFERENCING_LOCALLY: Message = Message::new("", "`defineEmits` is referencing locally declared variables.");
const DEFINE_IN_BOTH: Message = Message::new("", "Custom events are defined in both `defineEmits` and `export default {}`.");

impl Rule for ValidDefineEmits {
    const META: Meta = Meta::oxlint(Plugin::Vue, "valid-define-emits", Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        ValidDefineEmits
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !is_vue_setup(file) || !file.mentions("defineEmits") {
            return None;
        }
        Some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let calls = calls_of(cx.file(), "defineEmits");
        for (call_expr, _) in calls.iter().skip(1) {
            cx.report(call_expr, CALLED_MULTIPLE_TIMES)
                .first_label("`defineEmits` is called here")
                .label(calls.first().map(|it| it.0.span()).unwrap_or_default(), "`defineEmits` is called here too");
        }
        let Some((call_expr, call)) = calls.first() else {
            return;
        };
        let message = match check_define_macro_call_expression(*call, cx.file().vue_script().other_exports_emits) {
            Some(DefineMacroProblem::DefineInBoth) => DEFINE_IN_BOTH,
            Some(DefineMacroProblem::HasTypeAndArguments) => HAS_TYPE_AND_ARGUMENTS,
            Some(DefineMacroProblem::EventsNotDefined) => EVENTS_NOT_DEFINED,
            Some(DefineMacroProblem::ReferencingLocally) => REFERENCING_LOCALLY,
            None => return,
        };
        cx.report(call_expr, message);
    }
}
