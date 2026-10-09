use crate::oxlint::vue::{DefineMacroProblem, calls_of, check_define_macro_call_expression, is_vue_setup};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce valid usage of the `defineProps` compiler macro in Vue.
pub struct ValidDefineProps;

const HAS_TYPE_AND_ARGUMENTS: Message = Message::new("", "`defineProps` has both a type-only emit and an argument.");
const CALLED_MULTIPLE_TIMES: Message = Message::new("", "`defineProps` has been called multiple times.");
const EVENTS_NOT_DEFINED: Message = Message::new("", "Props are not defined.");
const REFERENCING_LOCALLY: Message = Message::new("", "`defineProps` is referencing locally declared variables.");
const DEFINE_IN_BOTH: Message = Message::new("", "Props are defined in both `defineProps` and `export default {}`.");

impl Rule for ValidDefineProps {
    const META: Meta = Meta::oxlint(Plugin::Vue, "valid-define-props", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        ValidDefineProps
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !is_vue_setup(file) || !file.mentions("defineProps") {
            return;
        }
        on.finish(|_, cx| {
            let calls = calls_of(cx.file(), "defineProps");
            for (call_expr, _) in calls.iter().skip(1) {
                cx.report(call_expr, CALLED_MULTIPLE_TIMES);
            }
            let Some((call_expr, call)) = calls.first() else {
                return;
            };
            let message = match check_define_macro_call_expression(*call, cx.file().vue_script().other_exports_props) {
                Some(DefineMacroProblem::DefineInBoth) => DEFINE_IN_BOTH,
                Some(DefineMacroProblem::HasTypeAndArguments) => HAS_TYPE_AND_ARGUMENTS,
                Some(DefineMacroProblem::EventsNotDefined) => EVENTS_NOT_DEFINED,
                Some(DefineMacroProblem::ReferencingLocally) => REFERENCING_LOCALLY,
                None => return,
            };
            cx.report(call_expr, message);
        });
    }
}
