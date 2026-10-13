//! In which order oxlint prints what its rules report about a file.
//!
//! It sorts nothing: what is reported first is printed first. This is how it runs (`execute_rules`): first `run_once` of
//! each rule, by the number of the rule; then the nodes, the outer before the inner, each with the rules by their
//! numbers; then the calls of Jest, each with the rules by their numbers. What tsgolint reports comes last.
//!
//! The rules here run in another way, so what they report is put in that order afterwards. `Linter::lint` has the four
//! parts one after the other, and the rules of the first by their numbers. In the others the start of what is reported
//! stands in for the node that oxlint's rule is called with, and [`of`] decides about what starts at one place.
//!
//! A rule may report an inner node while it is called with an outer one. So the kinds of node that it is called with
//! count before its number.
//!
//! Made from `generated/rule_runner_impls.rs` of oxlint 1.87.

use crate::rule::When::{AtTheEnd, Entering, Last, Once};
use crate::rule::{Meta, Plugin, When};
use crate::utils::sort;
use bun_core::strings;
use bun_wyhash::hash_const;
use std::sync::LazyLock;

/// When oxlint reports what `rule` reports, and what its rules are to be sorted by: of two that are called with nodes,
/// and report the same span, the one that is called with the outer node comes first, then the one with the lower
/// number. A rule that oxlint has not comes after its rules.
pub(crate) fn of(rule: &Meta) -> (When, u16) {
    let found = BY_KEY.binary_search_by_key(&key(rule.plugin, rule.name.as_bytes()), |it| it.0);
    match found.ok().and_then(|at| BY_KEY.get(at)) {
        Some(found) => (found.1, found.2),
        None => (Entering, u16::MAX),
    }
}

/// Whether what `rule` reports stays in the order in which the rule here reports it. oxlint's goes through a hash table of oxc,
/// and the rule here follows it.
pub(crate) fn keeps_its_order(rule: &Meta) -> bool {
    rule.plugin == Plugin::Eslint && rule.name == "no-undef"
}

fn key(plugin: Plugin, name: &[u8]) -> u32 {
    hash_const(hash_const(0, plugin.prefix().as_bytes()), name) as u32
}

/// Each rule of [`RULES`]: its [`key`], by which they are sorted, and what [`of`] returns. The number of a rule is its place
/// among all of them, by the plugin and the name.
static BY_KEY: LazyLock<Vec<(u32, When, u16)>> = LazyLock::new(|| {
    let rank = |plugin: Plugin| RULES.iter().position(|it| it.0 == plugin.in_oxlint());
    let mut all = Vec::new();
    for (plugin, lists) in RULES {
        for (when, outer, names) in *lists {
            let names = strings::split(names.as_bytes(), b" ");
            all.extend(names.map(|name| (rank(*plugin), name, *plugin, *when, *outer)));
        }
    }
    sort::sort_unstable_by_key(&mut all, |it| (it.0, it.1));
    let mut by_key: Vec<_> = (all.iter().zip(0u16..))
        .map(|(it, number)| (key(it.2, it.1), it.3, (it.4 << 10) | number))
        .collect();
    sort::sort_unstable_by_key(&mut by_key, |it| it.0);
    by_key
});

/// The plugins in the order of oxlint. The rules of each by when they report, `run_once` ([`Once`]), `run` ([`Entering`]),
/// `run_on_jest_node` ([`AtTheEnd`]) or tsgolint ([`Last`]), and by how far out the outermost kind of node is that they are
/// called with (`NODE_TYPES`): 0 for the program. The names are separated by spaces.
#[rustfmt::skip]
static RULES: &[(Plugin, &[(When, u16, &str)])] = &[
    (Plugin::Import, &[
        (Once, 0, concat!(
            "default export exports-last extensions first group-exports max-dependencies named namespace no-cycle ",
            "no-default-export no-duplicates no-named-as-default no-named-as-default-member no-namespace ",
            "no-self-import prefer-default-export unambiguous",
        )),
        (Entering, 1, concat!(
            "no-anonymous-default-export no-mutable-exports no-named-export no-nodejs-modules ",
            "no-relative-parent-imports",
        )),
        (Entering, 2, concat!(
            "consistent-type-specifier-style newline-after-import no-absolute-path no-empty-named-blocks ",
            "no-named-default no-unassigned-import no-webpack-loader-syntax",
        )),
        (Entering, 8, "no-amd no-commonjs no-dynamic-require"),
    ]),
    (Plugin::Eslint, &[
        (Once, 0, concat!(
            "capitalized-comments max-classes-per-file max-lines max-statements no-dupe-class-members ",
            "no-duplicate-imports no-extend-native no-global-assign no-implicit-globals no-inline-comments ",
            "no-irregular-whitespace no-redeclare no-restricted-globals no-restricted-imports no-shadow ",
            "no-shadow-restricted-names no-this-before-super no-undef no-unreachable no-unused-labels ",
            "no-unused-private-class-members no-unused-vars no-useless-assignment no-warning-comments one-var ",
            "prefer-rest-params sort-imports unicode-bom",
        )),
        (Entering, 0, "no-eval"),
        (Entering, 1, "no-restricted-exports no-useless-rename"),
        (Entering, 2, concat!(
            "block-scoped-var complexity curly default-case default-case-last for-direction guard-for-in ",
            "init-declarations logical-assignment-operators max-depth no-await-in-loop no-cond-assign ",
            "no-constant-condition no-constructor-return no-continue no-debugger no-dupe-else-if no-duplicate-case ",
            "no-else-return no-empty no-empty-function no-empty-static-block no-extra-label no-fallthrough ",
            "no-import-assign no-inner-declarations no-label-var no-labels no-lone-blocks no-lonely-if no-loop-func ",
            "no-negated-condition no-setter-return no-throw-literal no-unmodified-loop-condition no-unreachable-loop ",
            "no-unsafe-finally no-unused-expressions no-useless-catch no-useless-return no-var no-with prefer-const ",
            "preserve-caught-error require-await sort-vars use-isnan vars-on-top",
        )),
        (Entering, 3, "constructor-super no-class-assign"),
        (Entering, 4, "accessor-pairs grouped-accessor-pairs"),
        (Entering, 5, concat!(
            "class-methods-use-this func-name-matching no-case-declarations no-const-assign no-multi-assign ",
            "no-unassigned-vars no-underscore-dangle no-useless-computed-key no-useless-constructor object-shorthand ",
            "prefer-destructuring",
        )),
        (Entering, 6, concat!(
            "array-callback-return arrow-body-style default-param-last func-names func-style getter-return ",
            "max-lines-per-function max-nested-callbacks max-params no-func-assign prefer-arrow-callback require-yield",
        )),
        (Entering, 7, "no-ex-assign no-param-reassign"),
        (Entering, 8, concat!(
            "eqeqeq new-cap no-alert no-array-constructor no-async-promise-executor no-bitwise no-caller ",
            "no-compare-neg-zero no-console no-constant-binary-expression no-control-regex no-delete-var no-dupe-keys ",
            "no-eq-null no-extra-bind no-extra-boolean-cast no-implicit-coercion no-implied-eval no-invalid-regexp ",
            "no-iterator no-misleading-character-class no-nested-ternary no-new no-new-func ",
            "no-new-native-nonconstructor no-new-wrappers no-obj-calls no-object-constructor no-plusplus ",
            "no-promise-executor-return no-proto no-prototype-builtins no-regex-spaces no-restricted-properties ",
            "no-return-assign no-script-url no-self-assign no-self-compare no-sequences no-sparse-arrays no-ternary ",
            "no-unexpected-multiline no-unneeded-ternary no-unsafe-negation no-unsafe-optional-chaining ",
            "no-useless-backreference no-useless-call no-useless-concat no-useless-escape no-void operator-assignment ",
            "prefer-exponentiation-operator prefer-named-capture-group prefer-numeric-literals prefer-object-has-own ",
            "prefer-object-spread prefer-promise-reject-errors prefer-regex-literals prefer-spread prefer-template ",
            "radix require-unicode-regexp sort-keys symbol-description valid-typeof yoda",
        )),
        (Entering, 9, "no-empty-pattern"),
        (Entering, 10, concat!(
            "id-denylist id-length id-match no-div-regex no-empty-character-class no-loss-of-precision ",
            "no-magic-numbers no-multi-str no-nonoctal-decimal-escape no-template-curly-in-string no-undefined ",
            "no-use-before-define",
        )),
    ]),
    (Plugin::TypeScript, &[
        (Once, 0, "ban-ts-comment ban-tslint-comment prefer-ts-expect-error triple-slash-reference"),
        (Entering, 0, "adjacent-overload-signatures unified-signatures"),
        (Entering, 1,
            "consistent-type-definitions explicit-module-boundary-types no-useless-empty-export prefer-function-type"),
        (Entering, 2, concat!(
            "consistent-indexed-object-style consistent-type-imports no-empty-interface no-empty-object-type ",
            "no-import-type-side-effects no-misused-new no-require-imports no-unsafe-declaration-merging prefer-for-of",
        )),
        (Entering, 3, "no-extraneous-class parameter-properties"),
        (Entering, 4, "class-literal-property-style no-duplicate-enum-values prefer-enum-initializers"),
        (Entering, 5, concat!(
            "consistent-generic-constructors explicit-member-accessibility method-signature-style no-inferrable-types ",
            "no-this-alias no-unnecessary-parameter-property-assignment prefer-as-const prefer-literal-enum-member",
        )),
        (Entering, 6, "explicit-function-return-type"),
        (Entering, 7, "no-unnecessary-type-constraint"),
        (Entering, 8, concat!(
            "array-type ban-types consistent-type-assertions no-confusing-non-null-assertion no-dynamic-delete ",
            "no-explicit-any no-extra-non-null-assertion no-invalid-void-type no-namespace ",
            "no-non-null-asserted-nullish-coalescing no-non-null-asserted-optional-chain no-non-null-assertion ",
            "no-restricted-types no-unsafe-function-type no-var-requires no-wrapper-object-types ",
            "prefer-namespace-keyword",
        )),
        (Last, 0, concat!(
            "await-thenable consistent-return consistent-type-exports dot-notation no-array-delete no-base-to-string ",
            "no-confusing-void-expression no-deprecated no-duplicate-type-constituents no-floating-promises ",
            "no-for-in-array no-generated-empty-object-type no-implied-eval no-meaningless-void-operator ",
            "no-misused-promises no-misused-spread no-mixed-enums no-redundant-type-constituents ",
            "no-unnecessary-boolean-literal-compare no-unnecessary-condition no-unnecessary-qualifier ",
            "no-unnecessary-template-expression no-unnecessary-type-arguments no-unnecessary-type-assertion ",
            "no-unnecessary-type-conversion no-unnecessary-type-parameters no-unsafe-argument no-unsafe-assignment ",
            "no-unsafe-call no-unsafe-enum-comparison no-unsafe-member-access no-unsafe-return ",
            "no-unsafe-type-assertion no-unsafe-unary-minus no-useless-default-assignment ",
            "non-nullable-type-assertion-style only-throw-error prefer-find prefer-includes prefer-nullish-coalescing ",
            "prefer-optional-chain prefer-promise-reject-errors prefer-readonly prefer-readonly-parameter-types ",
            "prefer-reduce-type-parameter prefer-regexp-exec prefer-return-this-type prefer-string-starts-ends-with ",
            "promise-function-async related-getter-setter-pairs require-array-sort-compare require-await ",
            "restrict-plus-operands restrict-template-expressions return-await strict-boolean-expressions ",
            "strict-void-return switch-exhaustiveness-check unbound-method use-unknown-in-catch-callback-variable",
        )),
    ]),
    (Plugin::Jest, &[
        (Once, 0, concat!(
            "consistent-test-it max-expects max-nested-describe no-commented-out-tests no-confusing-set-timeout ",
            "no-duplicate-hooks no-export no-identical-title no-jasmine-globals no-large-snapshots no-mocks-import ",
            "no-standalone-expect prefer-each prefer-expect-assertions prefer-hooks-in-order prefer-hooks-on-top ",
            "prefer-importing-jest-globals prefer-snapshot-hint require-top-level-describe valid-expect",
        )),
        (Entering, 0, "require-hook"),
        (Entering, 2, "no-conditional-in-test no-test-return-statement"),
        (Entering, 8, concat!(
            "no-deprecated-functions prefer-jest-mocked prefer-mock-promise-shorthand prefer-mock-return-shorthand ",
            "prefer-spy-on",
        )),
        (AtTheEnd, 0, concat!(
            "expect-expect no-alias-methods no-conditional-expect no-disabled-tests no-done-callback no-focused-tests ",
            "no-hooks no-interpolation-in-snapshots no-restricted-jest-methods no-restricted-matchers no-test-prefixes ",
            "no-unneeded-async-expect-function no-untyped-mock-factory padding-around-after-all-blocks ",
            "padding-around-test-blocks prefer-called-with prefer-comparison-matcher prefer-ending-with-an-expect ",
            "prefer-equality-matcher prefer-expect-resolves prefer-lowercase-title prefer-strict-equal prefer-to-be ",
            "prefer-to-contain prefer-to-have-been-called prefer-to-have-been-called-times prefer-to-have-length ",
            "prefer-todo require-to-throw-message valid-describe-callback valid-expect-in-promise valid-title",
        )),
    ]),
    (Plugin::React, &[
        (Once, 0, concat!(
            "capitalized-calls display-name error-boundaries exhaustive-effect-dependencies globals hooks immutability ",
            "incompatible-library invariant jsx-filename-extension memo-dependencies no-deriving-state-in-effects ",
            "no-multi-comp only-export-components preserve-manual-memoization purity refs rule-suppression ",
            "set-state-in-effect set-state-in-render static-components syntax todo unsupported-syntax use-memo ",
            "void-use-memo",
        )),
        (Entering, 3, concat!(
            "no-redundant-should-component-update no-unstable-nested-components prefer-es6-class ",
            "prefer-function-component",
        )),
        (Entering, 5,
            "jsx-handler-names jsx-props-no-spreading no-children-prop no-string-refs no-unsafe state-in-constructor"),
        (Entering, 6, "function-component-definition require-render-return"),
        (Entering, 8, concat!(
            "button-has-type checked-requires-onchange-or-readonly forbid-component-props forbid-dom-props ",
            "forbid-elements forward-ref-uses-ref hook-use-state iframe-missing-sandbox jsx-boolean-value ",
            "jsx-curly-brace-presence jsx-fragments jsx-key jsx-max-depth jsx-no-constructed-context-values ",
            "jsx-no-duplicate-props jsx-no-literals jsx-no-script-url jsx-no-target-blank jsx-no-undef ",
            "jsx-no-useless-fragment jsx-pascal-case jsx-props-no-spread-multi no-array-index-key no-clone-element ",
            "no-danger no-danger-with-children no-did-mount-set-state no-did-update-set-state no-direct-mutation-state ",
            "no-find-dom-node no-is-mounted no-namespace no-react-children no-render-return-value no-set-state ",
            "no-unknown-property no-will-update-set-state react-in-jsx-scope self-closing-comp style-prop-object ",
            "void-dom-elements-no-children",
        )),
        (Entering, 9, "no-object-type-as-default-prop"),
        (Entering, 10, "jsx-no-comment-textnodes no-this-in-sfc no-unescaped-entities"),
    ]),
    (Plugin::ReactPerf, &[
        (Entering, 5,
            "jsx-no-jsx-as-prop jsx-no-new-array-as-prop jsx-no-new-function-as-prop jsx-no-new-object-as-prop"),
    ]),
    (Plugin::Unicorn, &[
        (Once, 0, "consistent-function-scoping filename-case no-abusive-eslint-disable no-empty-file"),
        (Entering, 1,
            "import-style no-anonymous-default-export no-thenable require-module-attributes require-module-specifiers"),
        (Entering, 2, concat!(
            "consistent-assert empty-brace-spaces no-immediate-mutation no-lonely-if no-negated-condition ",
            "no-useless-iterator-to-array no-useless-switch-case prefer-classlist-toggle prefer-default-parameters ",
            "prefer-export-from prefer-module prefer-node-protocol prefer-single-call prefer-ternary prefer-type-error ",
            "switch-case-braces",
        )),
        (Entering, 3, "custom-error-definition no-static-only-class prefer-class-fields prefer-event-target"),
        (Entering, 5, "no-this-assignment prefer-array-find prefer-set-has switch-case-break-position"),
        (Entering, 6, "prefer-native-coercion-functions"),
        (Entering, 7, "catch-error-name no-object-as-default-parameter prefer-optional-catch-binding"),
        (Entering, 8, concat!(
            "consistent-date-clone consistent-empty-array-spread consistent-existence-index-check ",
            "consistent-template-literal-escape error-message escape-case explicit-length-check explicit-timer-delay ",
            "max-nested-calls new-for-builtins no-array-callback-reference no-array-fill-with-reference-type ",
            "no-array-for-each no-array-method-this-argument no-array-reduce no-array-reverse no-array-sort ",
            "no-await-expression-member no-await-in-promise-methods no-confusing-array-with no-console-spaces ",
            "no-document-cookie no-hex-escape no-instanceof-array no-instanceof-builtins no-invalid-fetch-options ",
            "no-invalid-remove-event-listener no-length-as-slice-end no-magic-array-flat-depth ",
            "no-negation-in-equality-check no-nested-ternary no-new-array no-new-buffer no-process-exit ",
            "no-single-promise-in-promise-methods no-typeof-undefined no-unnecessary-array-flat-depth ",
            "no-unnecessary-array-splice-count no-unnecessary-await no-unnecessary-slice-end no-unreadable-iife ",
            "no-useless-collection-argument no-useless-error-capture-stack-trace no-useless-fallback-in-spread ",
            "no-useless-length-check no-useless-promise-resolve-reject no-useless-spread no-useless-undefined ",
            "prefer-add-event-listener prefer-array-flat prefer-array-flat-map prefer-array-index-of prefer-array-some ",
            "prefer-at prefer-bigint-literals prefer-blob-reading-methods prefer-code-point prefer-date-now ",
            "prefer-dom-node-append prefer-dom-node-dataset prefer-dom-node-remove prefer-dom-node-text-content ",
            "prefer-import-meta-properties prefer-includes prefer-keyboard-event-key ",
            "prefer-logical-operator-over-ternary prefer-math-min-max prefer-math-trunc prefer-modern-dom-apis ",
            "prefer-modern-math-apis prefer-negative-index prefer-number-coercion prefer-number-properties ",
            "prefer-object-from-entries prefer-prototype-methods prefer-query-selector prefer-reflect-apply ",
            "prefer-regexp-test prefer-response-static-json prefer-set-size prefer-spread prefer-string-replace-all ",
            "prefer-string-slice prefer-string-starts-ends-with prefer-string-trim-start-end prefer-structured-clone ",
            "prefer-top-level-await relative-url-style require-array-join-separator ",
            "require-number-to-fixed-digits-argument require-post-message-target-origin throw-new-error",
        )),
        (Entering, 9, "no-unreadable-array-destructuring"),
        (Entering, 10, concat!(
            "no-accessor-recursion no-null no-zero-fractions number-literal-case numeric-separators-style ",
            "prefer-global-this prefer-string-raw text-encoding-identifier-case",
        )),
    ]),
    (Plugin::JsxA11y, &[
        (Entering, 5, "aria-props aria-proptypes"),
        (Entering, 8, concat!(
            "alt-text anchor-ambiguous-text anchor-has-content anchor-is-valid aria-activedescendant-has-tabindex ",
            "aria-role aria-unsupported-elements autocomplete-valid click-events-have-key-events ",
            "control-has-associated-label heading-has-content html-has-lang iframe-has-title img-redundant-alt ",
            "interactive-supports-focus label-has-associated-control lang media-has-caption ",
            "mouse-events-have-key-events no-access-key no-aria-hidden-on-focusable no-autofocus ",
            "no-distracting-elements no-interactive-element-to-noninteractive-role ",
            "no-noninteractive-element-interactions no-noninteractive-element-to-interactive-role ",
            "no-noninteractive-tabindex no-redundant-roles no-static-element-interactions prefer-tag-over-role ",
            "role-has-required-aria-props role-supports-aria-props scope tabindex-no-positive",
        )),
    ]),
    (Plugin::Oxc, &[
        (Once, 0, "no-barrel-file"),
        (Entering, 1, "no-this-in-exported-function"),
        (Entering, 2, "branches-sharing-code no-const-enum"),
        (Entering, 6, "no-async-await only-used-in-recursion"),
        (Entering, 8, concat!(
            "bad-array-method-on-arguments bad-bitwise-operator bad-char-at-comparison bad-comparison-sequence ",
            "bad-match-all-arg bad-min-max-func bad-object-literal-comparison bad-replace-all-arg const-comparisons ",
            "double-comparisons erasing-op misrefactored-assign-op missing-throw no-accumulating-spread ",
            "no-async-endpoint-handlers no-map-spread no-optional-chaining no-rest-spread-properties ",
            "number-arg-out-of-range uninvoked-array-callback",
        )),
        (Entering, 10, "approx-constant"),
    ]),
    (Plugin::Nextjs, &[
        (Once, 0, "no-async-client-component"),
        (Entering, 2, concat!(
            "no-assign-module-variable no-document-import-in-page no-duplicate-head no-head-import-in-document ",
            "no-script-component-in-head no-title-in-document-head",
        )),
        (Entering, 5, "inline-script-id"),
        (Entering, 8, concat!(
            "google-font-display google-font-preconnect next-script-for-ga ",
            "no-before-interactive-script-outside-document no-css-tags no-head-element no-html-link-for-pages ",
            "no-img-element no-page-custom-font no-styled-jsx-in-document no-sync-scripts no-typos ",
            "no-unwanted-polyfillio",
        )),
    ]),
    (Plugin::Promise, &[
        (Entering, 2, "catch-or-return prefer-catch"),
        (Entering, 6, "always-return prefer-await-to-callbacks"),
        (Entering, 8, concat!(
            "avoid-new no-callback-in-promise no-multiple-resolved no-nesting no-new-statics no-promise-in-callback ",
            "no-return-in-finally no-return-wrap param-names prefer-await-to-then spec-only valid-params",
        )),
    ]),
    (Plugin::Vitest, &[
        (Once, 0, concat!(
            "consistent-test-filename consistent-test-it max-expects max-nested-describe no-commented-out-tests ",
            "no-duplicate-hooks no-identical-title no-import-node-test no-large-snapshots no-mocks-import ",
            "no-standalone-expect prefer-each prefer-expect-assertions prefer-hooks-in-order prefer-hooks-on-top ",
            "prefer-importing-vitest-globals prefer-snapshot-hint require-test-timeout require-top-level-describe ",
            "valid-expect",
        )),
        (Entering, 0, "prefer-called-exactly-once-with require-hook"),
        (Entering, 2,
            "consistent-vitest-vi no-conditional-in-test no-importing-vitest-globals no-test-return-statement"),
        (Entering, 8, "prefer-mock-promise-shorthand prefer-mock-return-shorthand prefer-spy-on"),
        (AtTheEnd, 0, concat!(
            "consistent-each-for expect-expect hoisted-apis-on-top no-alias-methods no-conditional-expect ",
            "no-conditional-tests no-disabled-tests no-focused-tests no-hooks no-interpolation-in-snapshots ",
            "no-restricted-matchers no-restricted-vi-methods no-test-prefixes no-unneeded-async-expect-function ",
            "padding-around-after-all-blocks padding-around-test-blocks prefer-called-once prefer-called-times ",
            "prefer-called-with prefer-comparison-matcher prefer-describe-function-title prefer-equality-matcher ",
            "prefer-expect-resolves prefer-expect-type-of prefer-import-in-mock prefer-lowercase-title ",
            "prefer-strict-boolean-matchers prefer-strict-equal prefer-to-be prefer-to-be-falsy prefer-to-be-object ",
            "prefer-to-be-truthy prefer-to-contain prefer-to-have-been-called-times prefer-to-have-length prefer-todo ",
            "require-awaited-expect-poll require-local-test-context-for-concurrent-snapshots ",
            "require-mock-type-parameters require-to-throw-message valid-describe-callback valid-expect-in-promise ",
            "valid-title warn-todo",
        )),
    ]),
    (Plugin::Node, &[
        (Once, 0, "exports-style"),
        (Entering, 2, "no-mixed-requires no-top-level-await"),
        (Entering, 6, "handle-callback-err"),
        (Entering, 8,
            "callback-return global-require no-exports-assign no-new-require no-path-concat no-process-env no-sync"),
    ]),
    (Plugin::ReactHooks, &[
        (Entering, 8, "exhaustive-deps rules-of-hooks"),
    ]),
];
