use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_react_compiler::{ErrorCategory, Flavor, rule};

/// A React Compiler rule, which reports the diagnostics of one category. `RULE` below `RULES.len()` is oxlint's
/// `react/..` rule for that entry of [`RULES`]. From `RULES.len()` on it's eslint-plugin-react-hooks' `react-hooks/..`
/// rule for the same entries.
///
/// The plugin's rule has one option, an object that's merged into the compiler's options. It's ignored here.
pub struct CompilerRule<const RULE: usize = 0>;

/// (name, category, its kind in oxlint, whether it's in the plugin's `recommended` config)
const RULES: [(&str, ErrorCategory, Kind, bool); 26] = [
    ("capitalized-calls", ErrorCategory::CapitalizedCalls, Kind::Problem, false),
    ("config", ErrorCategory::Config, Kind::Problem, true),
    ("error-boundaries", ErrorCategory::ErrorBoundaries, Kind::Problem, true),
    ("exhaustive-effect-dependencies", ErrorCategory::EffectExhaustiveDependencies, Kind::Problem, false),
    ("fbt", ErrorCategory::FBT, Kind::Problem, false),
    ("gating", ErrorCategory::Gating, Kind::Problem, true),
    ("globals", ErrorCategory::Globals, Kind::Problem, true),
    ("hooks", ErrorCategory::Hooks, Kind::Problem, false),
    ("immutability", ErrorCategory::Immutability, Kind::Problem, true),
    ("incompatible-library", ErrorCategory::IncompatibleLibrary, Kind::Problem, true),
    ("invariant", ErrorCategory::Invariant, Kind::Suggestion, false),
    ("memo-dependencies", ErrorCategory::MemoDependencies, Kind::Problem, false),
    ("memoized-effect-dependencies", ErrorCategory::EffectDependencies, Kind::Problem, false),
    ("no-deriving-state-in-effects", ErrorCategory::EffectDerivationsOfState, Kind::Suggestion, false),
    ("preserve-manual-memoization", ErrorCategory::PreserveManualMemo, Kind::Problem, true),
    ("purity", ErrorCategory::Purity, Kind::Problem, true),
    ("refs", ErrorCategory::Refs, Kind::Problem, true),
    ("rule-suppression", ErrorCategory::Suppression, Kind::Suggestion, false),
    ("set-state-in-effect", ErrorCategory::EffectSetState, Kind::Problem, true),
    ("set-state-in-render", ErrorCategory::RenderSetState, Kind::Problem, true),
    ("static-components", ErrorCategory::StaticComponents, Kind::Problem, true),
    ("syntax", ErrorCategory::Syntax, Kind::Suggestion, false),
    ("todo", ErrorCategory::Todo, Kind::Suggestion, false),
    ("unsupported-syntax", ErrorCategory::UnsupportedSyntax, Kind::Suggestion, true),
    ("use-memo", ErrorCategory::UseMemo, Kind::Problem, true),
    ("void-use-memo", ErrorCategory::VoidUseMemo, Kind::Problem, false),
];

impl<const RULE: usize> CompilerRule<RULE> {
    const FLAVOR: Flavor = if RULE < RULES.len() { Flavor::Oxlint } else { Flavor::Eslint };
    const CATEGORY: ErrorCategory = RULES[RULE % RULES.len()].1;
}

impl<const RULE: usize> Rule for CompilerRule<RULE> {
    const META: Meta = {
        let (name, category, kind, is_recommended) = RULES[RULE % RULES.len()];
        // The plugin marks every compiler rule as fixable with suggestions. None of them fix, and only these three suggest.
        let suggests = matches!(
            category,
            ErrorCategory::MemoDependencies | ErrorCategory::EffectExhaustiveDependencies | ErrorCategory::Syntax
        );
        let plugin_meta = Meta::plugin(Plugin::ReactHooks, name, Kind::Problem)
            .fixable(Fixable::Code)
            .has_suggestions()
            .never_fixes()
            .reports_on_creation();
        let plugin_meta = if suggests { plugin_meta } else { plugin_meta.never_suggests() };
        match (Self::FLAVOR, is_recommended) {
            (Flavor::Oxlint, _) => Meta::oxlint(Plugin::React, name, kind),
            (Flavor::Eslint, true) => plugin_meta.recommended(),
            (Flavor::Eslint, false) => plugin_meta,
        }
    };
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        Self
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        rule::starts(file, Self::FLAVOR, Self::CATEGORY).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        match Self::FLAVOR {
            Flavor::Oxlint => rule::report(cx, Self::CATEGORY),
            Flavor::Eslint => rule::report_as_eslint(cx, Self::CATEGORY),
        }
    }
}
