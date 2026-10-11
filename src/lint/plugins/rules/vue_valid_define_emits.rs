use crate::oxlint::vue::{DefineMacroProblem, calls_of, check_define_macro_call_expression, is_vue_setup};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce valid usage of the `defineEmits`, or the `defineProps`, compiler macro in Vue.
pub struct ValidDefine<const PROPS: bool = false>;

/// The rule, the macro, two labels.
const TEXTS: [[&str; 4]; 2] = [
    ["valid-define-emits", "defineEmits", "`defineEmits` is called here", "`defineEmits` is called here too"],
    ["valid-define-props", "defineProps", "`defineProps` is called here", "`defineProps` is called here too"],
];
/// It is called several times, then what is said of each [`DefineMacroProblem`].
const MESSAGES: [[Message; 5]; 2] = [
    [
        Message::new("", "`defineEmits` has been called multiple times."),
        Message::new("", "Custom events are defined in both `defineEmits` and `export default {}`."),
        Message::new("", "`defineEmits` has both a type-only emit and an argument."),
        Message::new("", "Custom events are not defined."),
        Message::new("", "`defineEmits` is referencing locally declared variables."),
    ],
    [
        Message::new("", "`defineProps` has been called multiple times."),
        Message::new("", "Props are defined in both `defineProps` and `export default {}`."),
        Message::new("", "`defineProps` has both a type-only emit and an argument."),
        Message::new("", "Props are not defined."),
        Message::new("", "`defineProps` is referencing locally declared variables."),
    ],
];

impl<const PROPS: bool> Rule for ValidDefine<PROPS> {
    const META: Meta = Meta::oxlint(Plugin::Vue, TEXTS[PROPS as usize][0], Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        Self
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (is_vue_setup(file) && file.mentions(TEXTS[PROPS as usize][1])).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let [_, name, here, here_too] = TEXTS[PROPS as usize];
        let [multiple_times, in_both, type_and_arguments, not_defined, locally] = MESSAGES[PROPS as usize];
        let calls = calls_of(cx.file(), name);
        for (call_expr, _) in calls.iter().skip(1) {
            cx.report(call_expr, multiple_times)
                .first_label(here)
                .label(calls.first().map(|it| it.0.span()).unwrap_or_default(), here_too);
        }
        let Some((call_expr, call)) = calls.first() else {
            return;
        };
        let script = cx.file().vue_script();
        let other_exports = if PROPS { script.other_exports_props } else { script.other_exports_emits };
        let message = match check_define_macro_call_expression(*call, other_exports) {
            Some(DefineMacroProblem::DefineInBoth) => in_both,
            Some(DefineMacroProblem::HasTypeAndArguments) => type_and_arguments,
            Some(DefineMacroProblem::EventsNotDefined) => not_defined,
            Some(DefineMacroProblem::ReferencingLocally) => locally,
            None => return,
        };
        cx.report(call_expr, message);
    }
}
