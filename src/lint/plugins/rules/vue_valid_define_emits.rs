use crate::oxlint::vue::{DefineMacroProblem, calls_of, check_define_macro_call_expression, is_vue_setup};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce valid usage of the `defineEmits`, or the `defineProps`, compiler macro in Vue.
pub struct ValidDefine<const PROPS: bool = false>;

/// The rule, the macro, two labels, and what is said of each problem.
const TEXTS: [[&str; 9]; 2] = [
    [
        "valid-define-emits",
        "defineEmits",
        "`defineEmits` is called here",
        "`defineEmits` is called here too",
        "`defineEmits` has been called multiple times.",
        "Custom events are defined in both `defineEmits` and `export default {}`.",
        "`defineEmits` has both a type-only emit and an argument.",
        "Custom events are not defined.",
        "`defineEmits` is referencing locally declared variables.",
    ],
    [
        "valid-define-props",
        "defineProps",
        "`defineProps` is called here",
        "`defineProps` is called here too",
        "`defineProps` has been called multiple times.",
        "Props are defined in both `defineProps` and `export default {}`.",
        "`defineProps` has both a type-only emit and an argument.",
        "Props are not defined.",
        "`defineProps` is referencing locally declared variables.",
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
        let [_, name, here, here_too, multiple_times, in_both, type_and_arguments, not_defined, locally] =
            TEXTS[PROPS as usize];
        let calls = calls_of(cx.file(), name);
        for (call_expr, _) in calls.iter().skip(1) {
            cx.report(call_expr, Message::new("", multiple_times))
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
        cx.report(call_expr, Message::new("", message));
    }
}
