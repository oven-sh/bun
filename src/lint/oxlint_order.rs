//! In which order oxlint has what several rules report at one start.
//!
//! It sorts by the start alone, which leaves what starts at one place in the order in which it was reported, and
//! this is how it runs (`execute_rules`): first `run_once` of each rule, by the number of the rule; then the nodes,
//! the outer before the inner, each with the rules by their numbers; then the calls of Jest, each with the rules by
//! their numbers. What tsgolint reports comes last.
//!
//! Made from `generated/rule_runner_impls.rs` of oxlint 1.87.

use crate::rule::{Meta, When};
use bun_wyhash::hash_const;

const ONCE: u16 = 0;
const RUN: u16 = 1;
const JEST: u16 = 2;
const TSGOLINT: u16 = 3;

const fn entry(runs: u16, number: u16) -> u16 {
    (runs << 10) | number
}

/// When oxlint reports what `rule` reports, and the number that `rule` has there. A rule that oxlint has not comes
/// after its rules.
pub(crate) fn of(rule: &Meta) -> (When, u16) {
    let prefix = hash_const(0, rule.plugin.prefix().as_bytes());
    let key = hash_const(prefix, rule.name.as_bytes()) as u32;
    let found = KEYS.binary_search(&key).ok().and_then(|at| RULES.get(at));
    let Some(found) = found else {
        return (When::Entering, u16::MAX);
    };
    let when = match found >> 10 {
        ONCE => When::Once,
        RUN => When::Entering,
        JEST => When::AtTheEnd,
        TSGOLINT => When::Last,
        _ => When::Entering,
    };
    (when, found & ((1 << 10) - 1))
}

/// Sorted.
static KEYS: [u32; 873] = [
    0x0099BDB8, // no-unsafe-negation
    0x00E15D0A, // @typescript-eslint/no-non-null-asserted-optional-chain
    0x00F6FA12, // @typescript-eslint/no-array-delete
    0x011E1378, // vitest/prefer-todo
    0x0135D344, // @typescript-eslint/no-confusing-non-null-assertion
    0x017C940E, // unicorn/no-array-callback-reference
    0x01F43B8C, // unicorn/no-zero-fractions
    0x025A397E, // no-import-assign
    0x027CF648, // block-scoped-var
    0x02B04FC7, // jsx-a11y/anchor-ambiguous-text
    0x02BD22D1, // unicorn/prefer-ternary
    0x0361D85A, // no-promise-executor-return
    0x03ACAD6F, // @next/next/next-script-for-ga
    0x03D9CBCB, // @typescript-eslint/no-var-requires
    0x03DBD6A0, // vitest/prefer-expect-assertions
    0x046E06F3, // @typescript-eslint/no-empty-object-type
    0x04CC29F3, // react/no-unescaped-entities
    0x051F0EE7, // no-unreachable-loop
    0x0543F475, // unicorn/prefer-modern-math-apis
    0x056DAA5C, // unicorn/prefer-object-from-entries
    0x05A5618C, // import/no-named-as-default-member
    0x05F9C373, // @typescript-eslint/no-unsafe-declaration-merging
    0x06B53934, // oxc/number-arg-out-of-range
    0x06CADBF8, // unicorn/no-array-reduce
    0x071B5F08, // jsx-a11y/role-has-required-aria-props
    0x078EBF6C, // vitest/prefer-each
    0x07C7138A, // n/handle-callback-err
    0x081AE494, // @typescript-eslint/prefer-function-type
    0x08721650, // unicorn/no-new-array
    0x0889099D, // unicorn/no-immediate-mutation
    0x093D6EC8, // jest/padding-around-after-all-blocks
    0x093F1287, // oxc/bad-array-method-on-arguments
    0x094E95A5, // jsdoc/check-tag-names
    0x094EAC7E, // @typescript-eslint/no-inferrable-types
    0x09675BC4, // id-length
    0x09E0610F, // unicorn/prefer-prototype-methods
    0x0B4FF9FC, // @typescript-eslint/consistent-type-exports
    0x0BA45AA5, // oxc/bad-bitwise-operator
    0x0BEC2824, // unicorn/explicit-timer-delay
    0x0C28B048, // @typescript-eslint/no-for-in-array
    0x0C3A7318, // jest/no-mocks-import
    0x0C41432E, // jest/prefer-jest-mocked
    0x0C5D88A6, // unicorn/no-useless-switch-case
    0x0C79AB69, // jsdoc/require-property-name
    0x0C7EE3E8, // jsdoc/require-throws-description
    0x0C83ADD4, // vitest/prefer-expect-resolves
    0x0CE770DF, // prefer-exponentiation-operator
    0x0D227BC4, // @typescript-eslint/ban-types
    0x0D9FFA82, // react/no-clone-element
    0x0DABEB74, // vue/no-multiple-slot-args
    0x0DDE77AF, // react/no-react-children
    0x0E0F18A3, // @next/next/no-head-element
    0x0E455954, // promise/prefer-await-to-then
    0x0E6F014D, // no-useless-return
    0x0E993C86, // react-hooks/rules-of-hooks
    0x0EAD7D28, // vitest/no-mocks-import
    0x0F3369EE, // jsx-a11y/role-supports-aria-props
    0x0F7BA3E0, // react/jsx-filename-extension
    0x0FC85396, // react/purity
    0x0FFC9513, // no-shadow-restricted-names
    0x1033E4F6, // no-undefined
    0x103D3B43, // react/no-is-mounted
    0x10423140, // @typescript-eslint/no-unsafe-argument
    0x105444CA, // no-multi-assign
    0x1095784D, // @typescript-eslint/prefer-promise-reject-errors
    0x10CFCC0C, // jest/no-interpolation-in-snapshots
    0x10E1F5FF, // unicorn/no-instanceof-array
    0x10EF9843, // vitest/no-standalone-expect
    0x11164414, // default-case
    0x11FAA834, // unicorn/no-await-expression-member
    0x128FB69F, // unicorn/prefer-negative-index
    0x12CE33E5, // curly
    0x12D2BD39, // n/no-process-env
    0x1336506C, // jest/no-test-prefixes
    0x13401F19, // prefer-numeric-literals
    0x135D8DAE, // unicorn/prefer-export-from
    0x13691895, // react/no-string-refs
    0x13A28386, // unicorn/catch-error-name
    0x13E7326C, // import/consistent-type-specifier-style
    0x1437F9CB, // react/void-dom-elements-no-children
    0x143E8540, // jest/no-done-callback
    0x1448E11D, // promise/valid-params
    0x146B97DB, // no-bitwise
    0x14B07E5C, // @typescript-eslint/ban-tslint-comment
    0x14D67BE8, // no-restricted-exports
    0x14E9962A, // jsx-a11y/no-autofocus
    0x1668E374, // no-plusplus
    0x16D38643, // @typescript-eslint/no-dynamic-delete
    0x177E2EAB, // react/no-did-mount-set-state
    0x178B75C8, // promise/no-new-statics
    0x17A8A89F, // @typescript-eslint/no-meaningless-void-operator
    0x1817B93F, // @typescript-eslint/no-unsafe-enum-comparison
    0x1832867A, // jsdoc/require-param
    0x18930BE9, // @typescript-eslint/no-misused-promises
    0x19A71FB8, // sort-vars
    0x1A54E600, // react/react-in-jsx-scope
    0x1A614960, // react/jsx-curly-brace-presence
    0x1A6839A5, // jest/no-disabled-tests
    0x1B71B4BA, // react/jsx-props-no-spreading
    0x1B9C44E1, // vue/no-async-in-computed-properties
    0x1C394C0D, // logical-assignment-operators
    0x1C492BAB, // jsx-a11y/anchor-has-content
    0x1C5B9A75, // no-negated-condition
    0x1CA93695, // jest/expect-expect
    0x1D9668EA, // unicorn/prefer-string-starts-ends-with
    0x1E3B8850, // unicorn/no-invalid-fetch-options
    0x1E73C727, // jsx-a11y/html-has-lang
    0x1F53DB2B, // @next/next/no-img-element
    0x1F664780, // react/no-redundant-should-component-update
    0x1F746F64, // vitest/no-test-return-statement
    0x1F951BC8, // unicorn/prefer-spread
    0x1F9AA45A, // unicorn/prefer-dom-node-remove
    0x1FD67C50, // max-lines
    0x2001DE0A, // @next/next/google-font-display
    0x200799CC, // @typescript-eslint/no-base-to-string
    0x201F47B7, // unicorn/no-array-fill-with-reference-type
    0x2033B94E, // jest/prefer-each
    0x20FCE516, // unicorn/no-array-reverse
    0x2116F57F, // @typescript-eslint/no-restricted-types
    0x219C09C6, // jsx-a11y/no-noninteractive-tabindex
    0x21D9072B, // no-unmodified-loop-condition
    0x21E40D9E, // unicorn/prefer-math-min-max
    0x221DE084, // import/export
    0x222C753E, // vue/no-this-in-before-route-enter
    0x2232F2A1, // vitest/consistent-vitest-vi
    0x22418573, // constructor-super
    0x22FD3462, // react/set-state-in-render
    0x230FE452, // vars-on-top
    0x231116C3, // jest/valid-expect-in-promise
    0x2354B400, // import/no-relative-parent-imports
    0x23AEB7CA, // react/todo
    0x2402CC80, // vue/no-watch-after-await
    0x2467D710, // oxc/missing-throw
    0x2469CA59, // vue/valid-define-emits
    0x24767D02, // @typescript-eslint/no-extra-non-null-assertion
    0x252335A7, // vitest/prefer-snapshot-hint
    0x2547E633, // unicorn/prefer-dom-node-append
    0x25A9F2FC, // unicorn/text-encoding-identifier-case
    0x25EB2452, // import/no-namespace
    0x263636B7, // unicorn/prefer-number-coercion
    0x26A1F411, // unicorn/prefer-default-parameters
    0x26BBF90B, // unicorn/prefer-array-flat
    0x26C66837, // jest/prefer-mock-return-shorthand
    0x27141890, // vitest/prefer-expect-type-of
    0x2739DC0B, // import/default
    0x273AC72F, // vitest/prefer-hooks-in-order
    0x2748CEF1, // unicorn/no-useless-iterator-to-array
    0x27D40E95, // unicorn/consistent-date-clone
    0x27D53A9E, // radix
    0x28010898, // unicorn/prefer-bigint-literals
    0x2885A2BC, // unicorn/no-new-buffer
    0x28C75FE6, // @typescript-eslint/no-unnecessary-type-assertion
    0x28DF8B9E, // default-param-last
    0x29086B43, // vue/require-direct-export
    0x2949120D, // preserve-caught-error
    0x298577F1, // vitest/prefer-import-in-mock
    0x2985D8B0, // vitest/prefer-describe-function-title
    0x2A067D32, // vitest/prefer-to-be-truthy
    0x2A39F7FB, // jsx-a11y/aria-activedescendant-has-tabindex
    0x2A517D0F, // unicorn/no-useless-error-capture-stack-trace
    0x2AA57858, // jsx-a11y/media-has-caption
    0x2AC100D4, // promise/spec-only
    0x2B784203, // no-constant-binary-expression
    0x2B90803B, // react/incompatible-library
    0x2BE091A8, // prefer-named-capture-group
    0x2C24520C, // jest/no-hooks
    0x2C8C6EE6, // jest/prefer-strict-equal
    0x2C914963, // vitest/prefer-mock-promise-shorthand
    0x2CB66B72, // vitest/prefer-to-have-length
    0x2CBF51CC, // @typescript-eslint/prefer-regexp-exec
    0x2CC3D533, // vitest/prefer-to-contain
    0x2D0FF2C9, // vitest/prefer-lowercase-title
    0x2D341510, // jsx-a11y/scope
    0x2DB80189, // vue/require-slots-as-functions
    0x2DF0D502, // jest/require-hook
    0x2E3B39DB, // no-underscore-dangle
    0x2E9A1C44, // react-perf/jsx-no-new-object-as-prop
    0x2EA07654, // func-names
    0x2F199E0F, // @typescript-eslint/return-await
    0x2F1B5C9C, // unicorn/require-module-specifiers
    0x2FC53889, // jsx-a11y/no-aria-hidden-on-focusable
    0x2FC8C226, // unicorn/require-post-message-target-origin
    0x3045F34E, // react/jsx-no-duplicate-props
    0x308B5BBB, // react/no-direct-mutation-state
    0x3165991B, // jsdoc/require-returns
    0x322FEA54, // vitest/prefer-comparison-matcher
    0x327FE1EF, // unicorn/prefer-array-find
    0x328D7678, // import/unambiguous
    0x32E4052C, // jsx-a11y/mouse-events-have-key-events
    0x32F6AE2B, // vue/no-arrow-functions-in-watch
    0x335DE328, // jest/no-untyped-mock-factory
    0x337BCB6E, // @typescript-eslint/related-getter-setter-pairs
    0x339B11D5, // id-match
    0x33A81207, // react/use-memo
    0x340AB0D6, // @typescript-eslint/promise-function-async
    0x343FAFE1, // vue/no-computed-properties-in-data
    0x34597EDF, // oxc/no-rest-spread-properties
    0x346E15DE, // react/rules-of-hooks
    0x3573182F, // unicorn/no-nested-ternary
    0x358F9276, // jest/no-jasmine-globals
    0x3607A07D, // jsx-a11y/aria-proptypes
    0x362C6632, // @typescript-eslint/dot-notation
    0x363D70A6, // react/no-set-state
    0x36A9572E, // @typescript-eslint/prefer-enum-initializers
    0x37047362, // jsdoc/require-yields-type
    0x375EB931, // vue/define-emits-declaration
    0x3780A789, // @typescript-eslint/no-extraneous-class
    0x37ADA751, // no-empty-pattern
    0x37BA7997, // jest/no-restricted-jest-methods
    0x382F85F0, // react/no-unstable-nested-components
    0x38F2BB0A, // max-depth
    0x392FBE70, // no-template-curly-in-string
    0x39607DEE, // react-hooks/exhaustive-deps
    0x39D6BFD2, // no-unsafe-finally
    0x39E3C8AC, // @next/next/no-document-import-in-page
    0x39F439CF, // jsdoc/require-throws-type
    0x3A8E1FAC, // vitest/no-large-snapshots
    0x3A8FBEA2, // jsx-a11y/aria-props
    0x3A9D30EC, // react/jsx-no-undef
    0x3ADE0032, // no-unreachable
    0x3B266DDE, // no-cond-assign
    0x3B730B59, // vue/no-deprecated-vue-config-keycodes
    0x3B7D76FE, // no-empty
    0x3BDCE81A, // no-compare-neg-zero
    0x3BF80F11, // vue/no-import-compiler-macros
    0x3C274C10, // no-const-assign
    0x3C6D8D0B, // unicorn/no-magic-array-flat-depth
    0x3D0B18CB, // promise/prefer-catch
    0x3D410273, // vue/no-reserved-keys
    0x3D82C161, // import/no-default-export
    0x3D96E1D6, // unicorn/consistent-assert
    0x3DAFEC6A, // unicorn/no-object-as-default-parameter
    0x3EB6CDB8, // prefer-rest-params
    0x3EBDC0EA, // import/named
    0x3EDD3254, // jsdoc/require-param-description
    0x3F2DF24A, // no-lonely-if
    0x3F3F55D1, // react/no-unsafe
    0x3F65BA45, // jest/no-test-return-statement
    0x40310D6F, // vue/no-shared-component-data
    0x40667B9B, // no-implied-eval
    0x407C34EA, // jest/prefer-hooks-on-top
    0x411337E9, // no-array-constructor
    0x420DF44C, // vitest/valid-expect-in-promise
    0x426CE7BC, // vue/return-in-computed-property
    0x4279EBE8, // jsdoc/implements-on-classes
    0x428DDC21, // no-inner-declarations
    0x4296DF61, // no-unexpected-multiline
    0x42AA526C, // jest/prefer-comparison-matcher
    0x42E928FC, // unicorn/require-number-to-fixed-digits-argument
    0x43045D4F, // react/memo-dependencies
    0x434E8DB9, // no-void
    0x43E4A1E5, // @typescript-eslint/prefer-for-of
    0x441D2A50, // jsx-a11y/aria-role
    0x44450F2F, // oxc/no-optional-chaining
    0x445C3D92, // @typescript-eslint/prefer-namespace-keyword
    0x445FB8E6, // unicorn/prefer-includes
    0x44EA8912, // unicorn/prefer-classlist-toggle
    0x452EB9C3, // @typescript-eslint/prefer-literal-enum-member
    0x45478880, // jsdoc/require-yields-description
    0x45D6714F, // vitest/no-focused-tests
    0x45FEBD77, // vitest/no-restricted-matchers
    0x4619031E, // unicorn/prefer-logical-operator-over-ternary
    0x463C67DC, // no-useless-assignment
    0x46D5BB4D, // no-redeclare
    0x47186885, // react/no-children-prop
    0x47490A2E, // react/no-multi-comp
    0x4781B721, // jest/valid-title
    0x47D0C5FA, // vitest/prefer-equality-matcher
    0x47E54EC1, // no-unused-vars
    0x47F6DDF8, // react/forbid-component-props
    0x481A4D91, // jest/no-identical-title
    0x48424592, // @next/next/google-font-preconnect
    0x48CD3B5D, // react/no-array-index-key
    0x48E65F40, // jest/padding-around-test-blocks
    0x4916AAED, // vitest/no-restricted-vi-methods
    0x4952B9D5, // @typescript-eslint/no-mixed-enums
    0x4978D481, // @next/next/no-styled-jsx-in-document
    0x49813D5A, // jsx-a11y/no-noninteractive-element-interactions
    0x49A93935, // react/hook-use-state
    0x49EB683F, // react/void-use-memo
    0x4A5239CA, // jest/prefer-to-contain
    0x4A8F4B9E, // @typescript-eslint/no-this-alias
    0x4A9A6E60, // import/no-unassigned-import
    0x4BA4084B, // oxc/bad-min-max-func
    0x4BAABE75, // @next/next/no-duplicate-head
    0x4C16AD9E, // promise/no-return-wrap
    0x4C1DD6CF, // vitest/valid-expect
    0x4C38FF64, // no-func-assign
    0x4CA109BB, // operator-assignment
    0x4D83095E, // oxc/no-this-in-exported-function
    0x4EC83704, // vitest/no-interpolation-in-snapshots
    0x4F2CF715, // unicorn/no-unnecessary-await
    0x4F49C08C, // unicorn/prefer-code-point
    0x4F8E4984, // unicorn/no-await-in-promise-methods
    0x4FEB4832, // jsx-a11y/anchor-is-valid
    0x5014519E, // jsx-a11y/tabindex-no-positive
    0x50D0B2A4, // no-extra-label
    0x5118F58E, // @typescript-eslint/use-unknown-in-catch-callback-variable
    0x51224CC5, // vue/max-props
    0x512B5C2E, // no-obj-calls
    0x518F14D8, // unicorn/no-empty-file
    0x51901E8F, // react/self-closing-comp
    0x51AEC897, // react/no-did-update-set-state
    0x51CDC1F6, // @typescript-eslint/no-unnecessary-parameter-property-assignment
    0x51D5474A, // no-else-return
    0x51FA7A25, // vitest/prefer-to-be-object
    0x529BF11E, // unicorn/prefer-native-coercion-functions
    0x52B0E022, // no-extra-boolean-cast
    0x52C98823, // @typescript-eslint/consistent-return
    0x52CFE795, // unicorn/no-static-only-class
    0x539532C7, // no-ternary
    0x54191A87, // @typescript-eslint/require-array-sort-compare
    0x54303E2B, // react/forbid-elements
    0x54DBBB0E, // jest/require-top-level-describe
    0x54EC0C7A, // no-param-reassign
    0x5521FB60, // unicorn/no-invalid-remove-event-listener
    0x5548741C, // vue/no-required-prop-with-default
    0x556558F0, // jest/valid-expect
    0x55BB2C41, // no-label-var
    0x55DDA789, // no-new
    0x5625A9EF, // prefer-template
    0x57C8A56D, // vue/next-tick-style
    0x5800846C, // no-nested-ternary
    0x58138E29, // vue/prefer-import-from-vue
    0x58789918, // import/no-webpack-loader-syntax
    0x595F5D4A, // oxc/only-used-in-recursion
    0x597FA266, // @typescript-eslint/no-invalid-void-type
    0x5990FDB1, // n/no-mixed-requires
    0x59B67784, // no-case-declarations
    0x5A246F61, // no-duplicate-case
    0x5A89F6FF, // unicorn/switch-case-braces
    0x5A989D7B, // no-script-url
    0x5B294D0F, // unicorn/switch-case-break-position
    0x5B774EAD, // react/no-this-in-sfc
    0x5BC74531, // react/refs
    0x5C24113E, // jsdoc/require-property-description
    0x5C501217, // one-var
    0x5CAA4DEC, // oxc/bad-char-at-comparison
    0x5CB57120, // unicorn/numeric-separators-style
    0x5D09F6DA, // unicorn/prefer-add-event-listener
    0x5D4F1195, // jsx-a11y/lang
    0x5D986450, // new-cap
    0x5E325520, // @typescript-eslint/consistent-type-imports
    0x5F07DA32, // vitest/no-conditional-tests
    0x5FAB1BD2, // unicorn/prefer-set-size
    0x5FB715FE, // arrow-body-style
    0x5FBC64CF, // @typescript-eslint/prefer-readonly
    0x5FFC8EC3, // unicorn/prefer-global-this
    0x600A0EFF, // unicorn/prefer-keyboard-event-key
    0x605ACD72, // react/rule-suppression
    0x608BDF36, // @typescript-eslint/no-unsafe-return
    0x612AB139, // vitest/prefer-called-with
    0x613553FD, // react/jsx-pascal-case
    0x6140A0F1, // react/no-danger
    0x614475EE, // react/invariant
    0x619E630B, // no-regex-spaces
    0x62181DFC, // vitest/require-awaited-expect-poll
    0x6242F5DD, // no-empty-function
    0x625D0FC7, // no-useless-constructor
    0x6339B83B, // vue/require-prop-types
    0x63839CFA, // prefer-spread
    0x640F7FD2, // eqeqeq
    0x6508C8F0, // vue/require-default-export
    0x6516BAF5, // oxc/bad-comparison-sequence
    0x6526A47A, // no-dupe-else-if
    0x6587F3DE, // no-restricted-globals
    0x65D4484A, // @typescript-eslint/no-unsafe-assignment
    0x65F702DB, // vue/require-render-return
    0x66411BF9, // promise/no-multiple-resolved
    0x6688E393, // vitest/no-importing-vitest-globals
    0x66CAA26B, // oxc/double-comparisons
    0x6716DDDB, // unicorn/prefer-optional-catch-binding
    0x6769AC60, // oxc/const-comparisons
    0x678FC3CB, // @typescript-eslint/no-implied-eval
    0x67996E3C, // no-irregular-whitespace
    0x68C9E043, // no-extend-native
    0x68D6B014, // array-callback-return
    0x68DF1CFE, // unicorn/prefer-string-slice
    0x68E5605E, // vitest/require-test-timeout
    0x68EABC3C, // import/no-duplicates
    0x6902D56F, // jsx-a11y/img-redundant-alt
    0x6914183D, // jest/no-conditional-expect
    0x693E8D93, // @typescript-eslint/no-unnecessary-condition
    0x695A39B0, // jsdoc/require-returns-description
    0x6A59F1BF, // unicorn/consistent-function-scoping
    0x6A62DADB, // no-useless-computed-key
    0x6ABCA201, // @typescript-eslint/consistent-generic-constructors
    0x6B3B9C28, // vue/no-deprecated-delete-set
    0x6B6055EB, // react/no-namespace
    0x6B9959BF, // @typescript-eslint/no-non-null-assertion
    0x6C56F303, // default-case-last
    0x6CDB4DDD, // no-constructor-return
    0x6CF46074, // no-invalid-regexp
    0x6DD7AB84, // @typescript-eslint/prefer-readonly-parameter-types
    0x6EA803D4, // unicorn/prefer-date-now
    0x6EB4D99F, // @typescript-eslint/consistent-indexed-object-style
    0x6F16D549, // class-methods-use-this
    0x6FC7AD57, // jest/prefer-to-have-been-called-times
    0x6FC8B413, // unicorn/no-useless-promise-resolve-reject
    0x6FF35B35, // unicorn/require-array-join-separator
    0x703ED472, // prefer-object-has-own
    0x705FDED3, // @typescript-eslint/no-namespace
    0x70846249, // unicorn/prefer-modern-dom-apis
    0x70EC89DA, // jsdoc/no-defaults
    0x7128EA76, // @typescript-eslint/consistent-type-definitions
    0x7143AC54, // @next/next/no-page-custom-font
    0x719B0EB2, // promise/avoid-new
    0x723AF0D2, // jest/prefer-snapshot-hint
    0x728F7F2A, // jsx-a11y/interactive-supports-focus
    0x73210440, // @next/next/no-title-in-document-head
    0x732B8A19, // jsdoc/check-property-names
    0x73B2D384, // @typescript-eslint/prefer-includes
    0x74007C6A, // no-useless-catch
    0x7400ABE4, // jest/no-duplicate-hooks
    0x7420C5D1, // @typescript-eslint/explicit-member-accessibility
    0x7435C448, // unicorn/empty-brace-spaces
    0x74835555, // n/no-exports-assign
    0x749C4130, // import/no-cycle
    0x74C58BDA, // vitest/valid-describe-callback
    0x75022993, // @next/next/no-sync-scripts
    0x75787ACD, // unicorn/no-useless-fallback-in-spread
    0x75CBF84D, // jest/valid-describe-callback
    0x75D5A5F4, // @typescript-eslint/prefer-nullish-coalescing
    0x76B6F814, // id-denylist
    0x76EB12A2, // no-useless-escape
    0x77173E6F, // no-delete-var
    0x77C3C696, // jsx-a11y/heading-has-content
    0x781D3CA6, // vitest/prefer-spy-on
    0x78257A54, // import/first
    0x7953BD81, // vitest/prefer-hooks-on-top
    0x7960A430, // no-dupe-keys
    0x79A2CDC2, // jest/prefer-spy-on
    0x7A3B7616, // n/no-new-require
    0x7A522F9F, // @next/next/no-async-client-component
    0x7ABE9B2A, // vitest/prefer-called-exactly-once-with
    0x7B284A82, // unicorn/prefer-set-has
    0x7B3FD6F8, // unicorn/no-this-assignment
    0x7B409D5C, // no-unsafe-optional-chaining
    0x7B4EA2C2, // no-var
    0x7B925F85, // jest/prefer-to-have-length
    0x7C011F30, // react/jsx-props-no-spread-multi
    0x7C1AC325, // no-useless-backreference
    0x7C29F2F5, // unicorn/prefer-array-index-of
    0x7C66FD86, // no-extra-bind
    0x7C71DF34, // import/no-commonjs
    0x7D44C34A, // unicorn/consistent-template-literal-escape
    0x7D59FB30, // vitest/prefer-strict-boolean-matchers
    0x7E0D2E19, // vitest/no-hooks
    0x7E3053B1, // react/no-render-return-value
    0x7E4B3A39, // for-direction
    0x7E5C7066, // jsdoc/check-access
    0x7EA176BD, // react/jsx-no-target-blank
    0x7ED61C38, // no-await-in-loop
    0x7EEC18EC, // no-setter-return
    0x7F08FC7A, // max-lines-per-function
    0x7F5DB2FD, // @typescript-eslint/no-non-null-asserted-nullish-coalescing
    0x7F6F6172, // react/exhaustive-effect-dependencies
    0x7FACFDFB, // vitest/padding-around-after-all-blocks
    0x7FBD6A6E, // @typescript-eslint/no-empty-interface
    0x7FFCC65A, // jest/no-alias-methods
    0x800220A0, // unicorn/consistent-empty-array-spread
    0x80CF0CCC, // prefer-promise-reject-errors
    0x81146F44, // no-misleading-character-class
    0x813FF4FD, // jsx-a11y/prefer-tag-over-role
    0x8149E5CC, // @typescript-eslint/parameter-properties
    0x81A46E4F, // vue/return-in-emits-validator
    0x82549F8B, // jest/no-deprecated-functions
    0x82AB70D5, // @typescript-eslint/no-wrapper-object-types
    0x8343B7CD, // init-declarations
    0x83D2F4B3, // vitest/consistent-each-for
    0x840712F5, // grouped-accessor-pairs
    0x8440513C, // unicorn/import-style
    0x849F1C02, // @typescript-eslint/only-throw-error
    0x84F51D65, // jsdoc/empty-tags
    0x852E246E, // no-continue
    0x853F7C8D, // no-iterator
    0x858964F8, // vue/no-lifecycle-after-await
    0x85DDA37C, // unicorn/prefer-string-trim-start-end
    0x868109B9, // no-unused-private-class-members
    0x86D7F8A5, // unicorn/prefer-dom-node-dataset
    0x87417372, // jest/no-unneeded-async-expect-function
    0x87AF3FE1, // oxc/no-async-await
    0x87B059F0, // jsdoc/no-blank-blocks
    0x87E55D39, // jest/prefer-expect-assertions
    0x88312F78, // no-control-regex
    0x88B3BCED, // jest/no-restricted-matchers
    0x88FBA99B, // vitest/require-hook
    0x890A56DA, // unicorn/no-unnecessary-array-flat-depth
    0x89391BAB, // no-caller
    0x895D7F04, // jest/prefer-called-with
    0x89C50A49, // max-nested-callbacks
    0x8A0AD455, // unicorn/require-module-attributes
    0x8A95BC52, // no-unused-labels
    0x8AD78F00, // react/forbid-dom-props
    0x8B15260B, // no-prototype-builtins
    0x8B62EDF6, // unicorn/no-thenable
    0x8BB36C54, // oxc/bad-match-all-arg
    0x8BC3867F, // import/group-exports
    0x8C49116C, // unicorn/no-useless-length-check
    0x8C63D5CF, // @typescript-eslint/no-unnecessary-qualifier
    0x8CA79A4C, // n/no-path-concat
    0x8CC94E1F, // react/only-export-components
    0x8CDA67D6, // vitest/require-local-test-context-for-concurrent-snapshots
    0x8E411AC6, // vitest/prefer-mock-return-shorthand
    0x8E8AFA3E, // unicorn/error-message
    0x8EC3EF5A, // unicorn/no-unreadable-array-destructuring
    0x8F0115ED, // promise/param-names
    0x8FB09C64, // react/iframe-missing-sandbox
    0x9063C779, // jsdoc/require-property
    0x9099F257, // vue/require-default-prop
    0x90A7D6B5, // no-useless-concat
    0x90C4EB66, // jest/no-export
    0x9179CFA3, // vitest/no-commented-out-tests
    0x918198B7, // no-new-wrappers
    0x91C997B0, // react/jsx-no-script-url
    0x91E65446, // vue/no-expose-after-await
    0x91F9BEF2, // @typescript-eslint/adjacent-overload-signatures
    0x92BADCD9, // @next/next/inline-script-id
    0x92D3EED1, // object-shorthand
    0x930CADBB, // jsx-a11y/autocomplete-valid
    0x93B9E55F, // unicorn/new-for-builtins
    0x93C2FD3D, // no-ex-assign
    0x9489F9CA, // react/static-components
    0x94C38362, // oxc/no-accumulating-spread
    0x95571F5C, // vue/require-prop-type-constructor
    0x95A9342E, // unicorn/prefer-blob-reading-methods
    0x95C77E58, // unicorn/consistent-existence-index-check
    0x95CC87A7, // jest/max-nested-describe
    0x960FF09B, // unicorn/throw-new-error
    0x965066C3, // unicorn/no-useless-collection-argument
    0x96A90C47, // @next/next/no-head-import-in-document
    0x9779ECF0, // vitest/no-conditional-expect
    0x97872E29, // sort-imports
    0x97C7192D, // @typescript-eslint/no-confusing-void-expression
    0x97D3E3BA, // vitest/no-conditional-in-test
    0x9878BAD4, // react/state-in-constructor
    0x9883DC1C, // unicorn/prefer-node-protocol
    0x99E105A2, // vue/no-deprecated-props-default-this
    0x9A33AE59, // accessor-pairs
    0x9A96EC00, // vitest/warn-todo
    0x9AB2AD52, // oxc/no-map-spread
    0x9ACD3C52, // unicorn/no-array-for-each
    0x9AF1B1AA, // react/style-prop-object
    0x9AF3339E, // unicorn/prefer-string-raw
    0x9B23D1AF, // @typescript-eslint/strict-void-return
    0x9BBB1C9E, // func-name-matching
    0x9BD5B38D, // oxc/no-barrel-file
    0x9C26EB0F, // import/no-absolute-path
    0x9C606CED, // react/jsx-no-constructed-context-values
    0x9CDC07CB, // @typescript-eslint/switch-exhaustiveness-check
    0x9D1ECB7E, // symbol-description
    0x9D952CF9, // @typescript-eslint/no-unnecessary-type-parameters
    0x9DC44E6F, // unicorn/no-process-exit
    0x9E0D3672, // no-restricted-properties
    0x9E2C21C2, // no-useless-call
    0x9F332323, // import/extensions
    0x9F68ABB2, // @next/next/no-before-interactive-script-outside-document
    0x9F9BB1DC, // max-classes-per-file
    0x9FF26FA9, // react/jsx-no-useless-fragment
    0x9FF4777E, // jsx-a11y/no-noninteractive-element-to-interactive-role
    0xA082931F, // import/no-named-as-default
    0xA08E8C50, // promise/no-return-in-finally
    0xA121B46C, // import/namespace
    0xA1AC3CAB, // no-async-promise-executor
    0xA1BDD4F7, // no-inline-comments
    0xA20DB9E9, // oxc/uninvoked-array-callback
    0xA238E08A, // no-self-assign
    0xA33191EF, // no-proto
    0xA3B7442A, // jest/prefer-hooks-in-order
    0xA41058F0, // no-throw-literal
    0xA4111330, // react/exhaustive-deps
    0xA46583DA, // jsx-a11y/alt-text
    0xA490FFAF, // jsx-a11y/click-events-have-key-events
    0xA499D795, // @typescript-eslint/no-unnecessary-type-constraint
    0xA4C21E7D, // @typescript-eslint/no-unnecessary-type-conversion
    0xA5A948B9, // react/globals
    0xA5B2331F, // promise/catch-or-return
    0xA5F377C9, // no-empty-static-block
    0xA6181D87, // unicorn/no-hex-escape
    0xA62695CB, // prefer-const
    0xA68C0E58, // @typescript-eslint/require-await
    0xA6A31F0B, // unicorn/prefer-response-static-json
    0xA6F33AB5, // vitest/no-alias-methods
    0xA7025C09, // @typescript-eslint/no-generated-empty-object-type
    0xA725A37A, // oxc/branches-sharing-code
    0xA737E5CC, // import/no-amd
    0xA7572E23, // react/capitalized-calls
    0xA7897263, // import/no-empty-named-blocks
    0xA81D2ACE, // no-undef
    0xA8532B04, // vue/no-deprecated-data-object-declaration
    0xA885A881, // unicode-bom
    0xA8C9B99B, // vue/component-definition-name-casing
    0xA91F01BF, // react/forward-ref-uses-ref
    0xA952C8BE, // @typescript-eslint/prefer-as-const
    0xA9A94EFB, // capitalized-comments
    0xAAB804A6, // @next/next/no-typos
    0xAAD6DCA8, // unicorn/no-unnecessary-slice-end
    0xAC7FBF25, // unicorn/prefer-structured-clone
    0xACD5C68D, // react/error-boundaries
    0xAD1D071E, // vue/prop-name-casing
    0xAD556F24, // @typescript-eslint/explicit-function-return-type
    0xAD6E0273, // prefer-object-spread
    0xADEF190F, // jest/no-focused-tests
    0xADF5E6DF, // require-unicode-regexp
    0xAE05B835, // react/jsx-no-comment-textnodes
    0xAE12324B, // jest/require-to-throw-message
    0xAF36FD6B, // no-fallthrough
    0xAF8A2D0F, // unicorn/no-console-spaces
    0xAF9356D1, // jsx-a11y/no-static-element-interactions
    0xAFEBD610, // unicorn/prefer-module
    0xAFF69C78, // import/exports-last
    0xB0FECB19, // import/newline-after-import
    0xB127731B, // @typescript-eslint/no-unsafe-type-assertion
    0xB14F0F07, // react/button-has-type
    0xB1C177E5, // react/jsx-handler-names
    0xB1F5FF0B, // unicorn/no-single-promise-in-promise-methods
    0xB2829EDF, // vitest/no-unneeded-async-expect-function
    0xB296BBAC, // unicorn/prefer-top-level-await
    0xB2EB6BDC, // @typescript-eslint/no-useless-default-assignment
    0xB364B95C, // unicorn/no-document-cookie
    0xB387143E, // @typescript-eslint/no-unsafe-function-type
    0xB3A786F0, // no-useless-rename
    0xB4140080, // react/preserve-manual-memoization
    0xB44FE0E7, // jest/prefer-lowercase-title
    0xB57725F6, // vitest/prefer-called-times
    0xB59366E4, // unicorn/prefer-import-meta-properties
    0xB5C79FC8, // no-self-compare
    0xB5D3C528, // func-style
    0xB64DEA03, // oxc/erasing-op
    0xB73C0D6D, // unicorn/no-lonely-if
    0xB831584D, // no-implicit-coercion
    0xB89DC620, // oxc/misrefactored-assign-op
    0xB8D41DE0, // unicorn/no-accessor-recursion
    0xB91889DB, // @typescript-eslint/prefer-optional-chain
    0xBA35DF4C, // @typescript-eslint/prefer-string-starts-ends-with
    0xBA574E01, // @typescript-eslint/unified-signatures
    0xBA6AD3C2, // @typescript-eslint/prefer-return-this-type
    0xBA9322A4, // guard-for-in
    0xBAC21D34, // no-new-native-nonconstructor
    0xBAECAECA, // jsx-a11y/iframe-has-title
    0xBB36DD32, // @next/next/no-script-component-in-head
    0xBB6AAC52, // @typescript-eslint/consistent-type-assertions
    0xBBE371CA, // @typescript-eslint/no-useless-empty-export
    0xBBE7ACF5, // @typescript-eslint/prefer-ts-expect-error
    0xBC1906ED, // react/prefer-function-component
    0xBC29191B, // n/no-sync
    0xBC797999, // vitest/consistent-test-it
    0xBCC60A79, // react/hooks
    0xBDE8DE66, // vitest/max-nested-describe
    0xBE169E8C, // jest/prefer-to-be
    0xBE25813A, // vue/require-typed-ref
    0xBECEA87A, // @next/next/no-css-tags
    0xBF1F0170, // import/no-nodejs-modules
    0xBF2E7F51, // no-duplicate-imports
    0xBFE2322B, // @typescript-eslint/triple-slash-reference
    0xC00361D2, // jest/no-commented-out-tests
    0xC154C7B5, // no-eval
    0xC1763C98, // promise/no-nesting
    0xC19299C4, // prefer-regex-literals
    0xC1986F5C, // no-object-constructor
    0xC1D8BC3C, // no-this-before-super
    0xC23FE2DA, // no-labels
    0xC249AD09, // vitest/no-identical-title
    0xC24B91D9, // import/prefer-default-export
    0xC27E55DB, // jest/prefer-todo
    0xC2A8E4E1, // jest/no-confusing-set-timeout
    0xC3252A70, // react/checked-requires-onchange-or-readonly
    0xC345E196, // jest/prefer-ending-with-an-expect
    0xC3565F52, // unicorn/prefer-regexp-test
    0xC3616D33, // unicorn/no-null
    0xC3B30BB2, // react-perf/jsx-no-jsx-as-prop
    0xC4208F90, // @typescript-eslint/no-require-imports
    0xC42C7B9D, // vue/no-side-effects-in-computed-properties
    0xC466F0A3, // n/exports-style
    0xC4A5B245, // import/no-dynamic-require
    0xC4D5B310, // prefer-destructuring
    0xC4FC4ADF, // vue/valid-define-props
    0xC512ABBD, // @typescript-eslint/no-import-type-side-effects
    0xC54CCA3B, // no-alert
    0xC56DE90E, // no-class-assign
    0xC5FBDE9D, // unicorn/custom-error-definition
    0xC6133832, // vue/no-reserved-component-names
    0xC6A52926, // jest/max-expects
    0xC6C24046, // jest/no-conditional-in-test
    0xC711BAF5, // no-debugger
    0xC73243DE, // @next/next/no-assign-module-variable
    0xC7548CEB, // oxc/no-async-endpoint-handlers
    0xC7E72361, // no-sparse-arrays
    0xC7F48E38, // react/no-will-update-set-state
    0xC9DF9979, // react/no-unknown-property
    0xC9F99ACC, // no-shadow
    0xCA4E3957, // react/immutability
    0xCAF763BD, // jest/prefer-equality-matcher
    0xCB20292B, // jest/no-large-snapshots
    0xCB2246F3, // vitest/no-duplicate-hooks
    0xCB23DA8A, // no-dupe-class-members
    0xCBD78FB4, // import/no-mutable-exports
    0xCBF18018, // vitest/no-disabled-tests
    0xCC073109, // no-unneeded-ternary
    0xCC183EE7, // vitest/hoisted-apis-on-top
    0xCC7C9B64, // vue/no-deprecated-model-definition
    0xCCB7EEC6, // unicorn/no-unnecessary-array-splice-count
    0xCCD3C1BC, // @typescript-eslint/restrict-plus-operands
    0xCD086DB5, // react/jsx-max-depth
    0xCD417657, // no-restricted-imports
    0xCDF04D6F, // unicorn/filename-case
    0xCE3C7841, // jest/prefer-importing-jest-globals
    0xCEF1A985, // unicorn/prefer-event-target
    0xCF9A07C0, // unicorn/prefer-type-error
    0xCFF633B1, // valid-typeof
    0xD05176E5, // no-implicit-globals
    0xD0524D66, // vue/define-props-destructuring
    0xD06FA1D6, // yoda
    0xD0726AE9, // unicorn/no-anonymous-default-export
    0xD082CBC7, // unicorn/no-array-sort
    0xD1E3DB36, // oxc/no-const-enum
    0xD1EB7DB2, // vitest/prefer-strict-equal
    0xD1FA48C9, // vue/no-deprecated-destroyed-lifecycle
    0xD20C5A7F, // @typescript-eslint/array-type
    0xD2282D6D, // jsdoc/require-param-name
    0xD257CE8A, // no-global-assign
    0xD2C1EC0E, // no-constant-condition
    0xD30F6387, // @typescript-eslint/no-unsafe-call
    0xD31AD8FC, // unicorn/prefer-array-some
    0xD3D7EC23, // @typescript-eslint/no-explicit-any
    0xD4BF5DD7, // @typescript-eslint/no-unnecessary-type-arguments
    0xD4C016A8, // promise/no-callback-in-promise
    0xD4CD7168, // @typescript-eslint/no-floating-promises
    0xD4D3C838, // unicorn/prefer-math-trunc
    0xD4F5042E, // react/no-find-dom-node
    0xD522D066, // jsx-a11y/no-interactive-element-to-noninteractive-role
    0xD53A0004, // vue/no-reserved-props
    0xD584CBAC, // vitest/require-to-throw-message
    0xD5AC098B, // @typescript-eslint/no-unnecessary-template-expression
    0xD62311FC, // unicorn/no-length-as-slice-end
    0xD6505877, // unicorn/prefer-at
    0xD679EDEC, // unicorn/prefer-reflect-apply
    0xD6B44A2C, // unicorn/relative-url-style
    0xD6D80081, // @typescript-eslint/no-unsafe-member-access
    0xD6F5AC7B, // no-with
    0xD7A21458, // oxc/bad-object-literal-comparison
    0xD80D12E1, // unicorn/explicit-length-check
    0xD826F00D, // vitest/require-mock-type-parameters
    0xD83CFD35, // unicorn/prefer-array-flat-map
    0xD84F7214, // require-await
    0xD88DF6EB, // @typescript-eslint/no-duplicate-type-constituents
    0xD8CE62AF, // @typescript-eslint/prefer-find
    0xD8F10AA9, // no-sequences
    0xD97CB5EA, // react/unsupported-syntax
    0xD9C13280, // @typescript-eslint/non-nullable-type-assertion-style
    0xDA138427, // unicorn/no-negation-in-equality-check
    0xDA550E02, // vitest/prefer-to-be-falsy
    0xDAE239E9, // react/jsx-boolean-value
    0xDB028074, // jsx-a11y/label-has-associated-control
    0xDB6D7996, // react/syntax
    0xDBF178F3, // @typescript-eslint/restrict-template-expressions
    0xDC3D7883, // jsdoc/require-returns-type
    0xDC5F5317, // @typescript-eslint/no-misused-spread
    0xDC8CC26F, // complexity
    0xDD25E8FB, // import/no-named-default
    0xDD6A5DDD, // jest/consistent-test-it
    0xDD94DA99, // unicorn/no-confusing-array-with
    0xDD96C324, // unicorn/no-abusive-eslint-disable
    0xDDE6B391, // no-loop-func
    0xDE84A0CE, // vitest/valid-title
    0xDF77DBDD, // unicorn/max-nested-calls
    0xDFDB8786, // prefer-arrow-callback
    0xE04269B6, // @typescript-eslint/no-duplicate-enum-values
    0xE067A734, // react-perf/jsx-no-new-function-as-prop
    0xE0B71871, // promise/no-promise-in-callback
    0xE150B957, // unicorn/prefer-dom-node-text-content
    0xE180CAF6, // no-eq-null
    0xE21B42B0, // no-unused-expressions
    0xE23C9034, // @typescript-eslint/class-literal-property-style
    0xE257B9DD, // use-isnan
    0xE295937B, // react/prefer-es6-class
    0xE31E7B82, // vitest/prefer-called-once
    0xE367BF23, // @typescript-eslint/no-misused-new
    0xE46F0890, // react/jsx-no-literals
    0xE4966237, // jest/prefer-expect-resolves
    0xE56C60F7, // jsx-a11y/no-distracting-elements
    0xE5C7E955, // vitest/max-expects
    0xE6073D2B, // unicorn/escape-case
    0xE66FF828, // vue/no-dupe-keys
    0xE6C801A4, // react/function-component-definition
    0xE6E4E885, // no-unassigned-vars
    0xE6F76220, // import/no-self-import
    0xE72DE009, // jsdoc/require-param-type
    0xE7703E92, // react/display-name
    0xE7E5BBFA, // react/no-danger-with-children
    0xE8495E8C, // vue/no-deprecated-events-api
    0xE87B3B9F, // react/no-deriving-state-in-effects
    0xE8ADFF26, // vitest/consistent-test-filename
    0xE8B34A2F, // react/require-render-return
    0xE8CF85DB, // max-params
    0xE91D518F, // sort-keys
    0xE98A6B4A, // oxc/bad-replace-all-arg
    0xE9918EB1, // import/no-anonymous-default-export
    0xEA099181, // react/set-state-in-effect
    0xEA31C882, // no-return-assign
    0xEB11D62E, // unicorn/no-unreadable-iife
    0xEB48F43F, // unicorn/number-literal-case
    0xEB571420, // no-warning-comments
    0xEBA36063, // @next/next/no-html-link-for-pages
    0xEBDC19C7, // unicorn/prefer-string-replace-all
    0xEBE55DF8, // jsdoc/require-yields
    0xEC4D9D1B, // vitest/expect-expect
    0xED1DF36C, // vitest/prefer-to-be
    0xED268383, // promise/always-return
    0xED63BE1A, // @typescript-eslint/no-redundant-type-constituents
    0xED894EBF, // vitest/padding-around-test-blocks
    0xEDAF010D, // require-yield
    0xEDBEFA52, // import/no-named-export
    0xEE5616D3, // @typescript-eslint/no-unsafe-unary-minus
    0xEF36D53A, // no-use-before-define
    0xF04259A4, // vue/valid-next-tick
    0xF04A2CB0, // @typescript-eslint/no-unnecessary-boolean-literal-compare
    0xF0D194E5, // unicorn/no-typeof-undefined
    0xF169E647, // no-empty-character-class
    0xF1E56BA0, // no-div-regex
    0xF2162CE5, // no-loss-of-precision
    0xF217C89C, // unicorn/no-instanceof-builtins
    0xF28632D2, // no-new-func
    0xF2DCD725, // jsx-a11y/no-access-key
    0xF2EF60C7, // unicorn/no-useless-undefined
    0xF3267F5D, // unicorn/prefer-single-call
    0xF3CAECAF, // vitest/no-import-node-test
    0xF41CD208, // promise/prefer-await-to-callbacks
    0xF4C3E4FF, // n/global-require
    0xF4F0161A, // no-lone-blocks
    0xF5282BBB, // vitest/prefer-to-have-been-called-times
    0xF5336787, // @typescript-eslint/ban-ts-comment
    0xF55DB266, // unicorn/no-negated-condition
    0xF64D59B6, // react-perf/jsx-no-new-array-as-prop
    0xF67D5143, // jsx-a11y/control-has-associated-label
    0xF750544A, // vitest/no-test-prefixes
    0xF7CE5E45, // getter-return
    0xF7F6E1DB, // import/max-dependencies
    0xF83472C3, // @next/next/no-unwanted-polyfillio
    0xF879B6CB, // unicorn/prefer-class-fields
    0xF89AC91B, // oxc/approx-constant
    0xF8DAB687, // @typescript-eslint/explicit-module-boundary-types
    0xF92757DF, // @typescript-eslint/strict-boolean-expressions
    0xF942A011, // @typescript-eslint/method-signature-style
    0xF95B979C, // react/no-object-type-as-default-prop
    0xF9774F39, // vue/define-props-declaration
    0xFA0CC20F, // vitest/require-top-level-describe
    0xFA5FB429, // jsdoc/require-property-type
    0xFAAD4A5A, // vue/no-export-in-script-setup
    0xFAB6516D, // vitest/prefer-importing-vitest-globals
    0xFB1A40DA, // unicorn/no-useless-spread
    0xFB255DDB, // jest/no-standalone-expect
    0xFB3CFC1A, // @typescript-eslint/no-deprecated
    0xFBAB855C, // react/jsx-fragments
    0xFC485DBB, // no-magic-numbers
    0xFC4A2CAA, // vue/valid-define-options
    0xFC714103, // unicorn/prefer-query-selector
    0xFC930680, // no-console
    0xFC940C7C, // jsx-a11y/no-redundant-roles
    0xFCBB0127, // jest/prefer-to-have-been-called
    0xFCC4D9F3, // react/jsx-key
    0xFCD078A9, // @typescript-eslint/await-thenable
    0xFD01A1B7, // jsx-a11y/aria-unsupported-elements
    0xFD36BF37, // @typescript-eslint/unbound-method
    0xFD79993D, // unicorn/no-array-method-this-argument
    0xFDF8582A, // no-multi-str
    0xFE2B6664, // unicorn/prefer-number-properties
    0xFE5C2FB6, // @typescript-eslint/prefer-reduce-type-parameter
    0xFEAFE22B, // n/callback-return
    0xFEC5486F, // no-nonoctal-decimal-escape
    0xFEDEEB08, // jest/prefer-mock-promise-shorthand
    0xFF505DF2, // max-statements
    0xFFC77A27, // n/no-top-level-await
];

/// Of the rule at the same place in [`KEYS`].
static RULES: [u16; 873] = [
    entry(RUN, 169),
    entry(RUN, 266),
    entry(TSGOLINT, 239),
    entry(JEST, 801),
    entry(RUN, 241),
    entry(RUN, 500),
    entry(RUN, 550),
    entry(RUN, 110),
    entry(RUN, 36),
    entry(RUN, 619),
    entry(RUN, 605),
    entry(RUN, 137),
    entry(RUN, 684),
    entry(RUN, 294),
    entry(ONCE, 780),
    entry(RUN, 248),
    entry(RUN, 449),
    entry(RUN, 167),
    entry(RUN, 581),
    entry(RUN, 588),
    entry(ONCE, 22),
    entry(RUN, 285),
    entry(RUN, 678),
    entry(RUN, 504),
    entry(RUN, 650),
    entry(ONCE, 778),
    entry(RUN, 817),
    entry(RUN, 303),
    entry(RUN, 525),
    entry(RUN, 514),
    entry(JEST, 359),
    entry(RUN, 655),
    entry(ONCE, 704),
    entry(RUN, 257),
    entry(RUN, 54),
    entry(RUN, 590),
    entry(TSGOLINT, 232),
    entry(RUN, 656),
    entry(RUN, 492),
    entry(TSGOLINT, 253),
    entry(ONCE, 351),
    entry(RUN, 371),
    entry(RUN, 548),
    entry(ONCE, 715),
    entry(ONCE, 720),
    entry(JEST, 781),
    entry(RUN, 196),
    entry(RUN, 225),
    entry(RUN, 431),
    entry(RUN, 846),
    entry(RUN, 443),
    entry(RUN, 691),
    entry(RUN, 737),
    entry(RUN, 185),
    entry(RUN, 463),
    entry(ONCE, 763),
    entry(RUN, 651),
    entry(ONCE, 412),
    entry(ONCE, 458),
    entry(ONCE, 153),
    entry(RUN, 161),
    entry(RUN, 439),
    entry(TSGOLINT, 282),
    entry(RUN, 124),
    entry(TSGOLINT, 309),
    entry(JEST, 348),
    entry(RUN, 515),
    entry(ONCE, 766),
    entry(RUN, 42),
    entry(RUN, 507),
    entry(RUN, 584),
    entry(RUN, 41),
    entry(RUN, 822),
    entry(JEST, 355),
    entry(RUN, 198),
    entry(RUN, 572),
    entry(RUN, 447),
    entry(RUN, 480),
    entry(RUN, 0),
    entry(RUN, 474),
    entry(JEST, 342),
    entry(RUN, 740),
    entry(RUN, 70),
    entry(ONCE, 224),
    entry(RUN, 142),
    entry(RUN, 641),
    entry(RUN, 136),
    entry(RUN, 246),
    entry(RUN, 435),
    entry(RUN, 731),
    entry(TSGOLINT, 259),
    entry(TSGOLINT, 286),
    entry(RUN, 709),
    entry(TSGOLINT, 261),
    entry(RUN, 213),
    entry(RUN, 459),
    entry(RUN, 411),
    entry(JEST, 341),
    entry(RUN, 427),
    entry(RUN, 832),
    entry(RUN, 57),
    entry(RUN, 620),
    entry(RUN, 126),
    entry(JEST, 332),
    entry(RUN, 602),
    entry(RUN, 517),
    entry(RUN, 631),
    entry(RUN, 694),
    entry(RUN, 444),
    entry(RUN, 768),
    entry(RUN, 598),
    entry(RUN, 569),
    entry(ONCE, 60),
    entry(RUN, 681),
    entry(TSGOLINT, 240),
    entry(RUN, 501),
    entry(ONCE, 363),
    entry(RUN, 505),
    entry(RUN, 270),
    entry(RUN, 646),
    entry(RUN, 164),
    entry(RUN, 578),
    entry(ONCE, 2),
    entry(RUN, 853),
    entry(RUN, 744),
    entry(RUN, 40),
    entry(ONCE, 466),
    entry(RUN, 218),
    entry(JEST, 389),
    entry(RUN, 27),
    entry(ONCE, 471),
    entry(RUN, 854),
    entry(RUN, 668),
    entry(ONCE, 867),
    entry(RUN, 250),
    entry(ONCE, 790),
    entry(RUN, 567),
    entry(RUN, 616),
    entry(ONCE, 25),
    entry(RUN, 586),
    entry(RUN, 566),
    entry(RUN, 555),
    entry(RUN, 374),
    entry(JEST, 782),
    entry(ONCE, 1),
    entry(ONCE, 783),
    entry(RUN, 544),
    entry(RUN, 482),
    entry(RUN, 207),
    entry(RUN, 560),
    entry(RUN, 526),
    entry(TSGOLINT, 278),
    entry(RUN, 44),
    entry(RUN, 859),
    entry(RUN, 206),
    entry(JEST, 785),
    entry(JEST, 777),
    entry(JEST, 797),
    entry(RUN, 622),
    entry(RUN, 542),
    entry(RUN, 637),
    entry(RUN, 739),
    entry(RUN, 78),
    entry(ONCE, 408),
    entry(RUN, 197),
    entry(JEST, 346),
    entry(JEST, 377),
    entry(RUN, 788),
    entry(JEST, 800),
    entry(TSGOLINT, 313),
    entry(JEST, 798),
    entry(JEST, 787),
    entry(RUN, 652),
    entry(RUN, 863),
    entry(RUN, 384),
    entry(RUN, 162),
    entry(RUN, 479),
    entry(RUN, 48),
    entry(TSGOLINT, 323),
    entry(RUN, 611),
    entry(RUN, 640),
    entry(RUN, 613),
    entry(RUN, 419),
    entry(RUN, 437),
    entry(ONCE, 717),
    entry(JEST, 776),
    entry(RUN, 554),
    entry(ONCE, 32),
    entry(RUN, 638),
    entry(RUN, 831),
    entry(JEST, 358),
    entry(TSGOLINT, 318),
    entry(RUN, 55),
    entry(ONCE, 473),
    entry(TSGOLINT, 317),
    entry(RUN, 833),
    entry(RUN, 676),
    entry(RUN, 463),
    entry(RUN, 524),
    entry(ONCE, 349),
    entry(RUN, 624),
    entry(TSGOLINT, 234),
    entry(RUN, 446),
    entry(RUN, 300),
    entry(ONCE, 724),
    entry(RUN, 826),
    entry(RUN, 251),
    entry(RUN, 95),
    entry(JEST, 352),
    entry(RUN, 452),
    entry(RUN, 59),
    entry(RUN, 155),
    entry(RUN, 396),
    entry(RUN, 168),
    entry(RUN, 689),
    entry(ONCE, 721),
    entry(ONCE, 762),
    entry(RUN, 623),
    entry(RUN, 423),
    entry(ONCE, 166),
    entry(RUN, 75),
    entry(RUN, 840),
    entry(RUN, 92),
    entry(RUN, 74),
    entry(RUN, 844),
    entry(RUN, 77),
    entry(RUN, 521),
    entry(RUN, 738),
    entry(RUN, 849),
    entry(ONCE, 16),
    entry(RUN, 481),
    entry(RUN, 528),
    entry(ONCE, 203),
    entry(ONCE, 8),
    entry(RUN, 710),
    entry(RUN, 119),
    entry(RUN, 451),
    entry(RUN, 356),
    entry(RUN, 851),
    entry(RUN, 109),
    entry(ONCE, 369),
    entry(RUN, 67),
    entry(JEST, 811),
    entry(RUN, 865),
    entry(RUN, 706),
    entry(RUN, 112),
    entry(RUN, 163),
    entry(JEST, 362),
    entry(RUN, 612),
    entry(ONCE, 428),
    entry(RUN, 187),
    entry(RUN, 302),
    entry(RUN, 625),
    entry(RUN, 675),
    entry(RUN, 306),
    entry(RUN, 575),
    entry(RUN, 563),
    entry(RUN, 305),
    entry(ONCE, 723),
    entry(JEST, 756),
    entry(JEST, 764),
    entry(RUN, 577),
    entry(ONCE, 176),
    entry(ONCE, 140),
    entry(RUN, 430),
    entry(ONCE, 440),
    entry(JEST, 390),
    entry(JEST, 779),
    entry(ONCE, 174),
    entry(RUN, 398),
    entry(ONCE, 347),
    entry(RUN, 682),
    entry(RUN, 429),
    entry(JEST, 360),
    entry(JEST, 765),
    entry(TSGOLINT, 263),
    entry(RUN, 697),
    entry(RUN, 644),
    entry(RUN, 404),
    entry(ONCE, 475),
    entry(JEST, 379),
    entry(RUN, 271),
    entry(RUN, 29),
    entry(RUN, 660),
    entry(RUN, 690),
    entry(RUN, 734),
    entry(ONCE, 810),
    entry(RUN, 105),
    entry(RUN, 192),
    entry(RUN, 677),
    entry(JEST, 761),
    entry(RUN, 537),
    entry(RUN, 564),
    entry(RUN, 508),
    entry(RUN, 621),
    entry(RUN, 653),
    entry(RUN, 103),
    entry(TSGOLINT, 330),
    entry(RUN, 829),
    entry(RUN, 133),
    entry(ONCE, 512),
    entry(RUN, 464),
    entry(RUN, 436),
    entry(RUN, 274),
    entry(RUN, 91),
    entry(JEST, 796),
    entry(RUN, 583),
    entry(RUN, 102),
    entry(TSGOLINT, 229),
    entry(RUN, 531),
    entry(RUN, 156),
    entry(TSGOLINT, 319),
    entry(RUN, 400),
    entry(ONCE, 386),
    entry(RUN, 135),
    entry(RUN, 518),
    entry(RUN, 847),
    entry(ONCE, 388),
    entry(RUN, 116),
    entry(RUN, 128),
    entry(RUN, 205),
    entry(RUN, 830),
    entry(RUN, 127),
    entry(ONCE, 855),
    entry(RUN, 30),
    entry(RUN, 679),
    entry(RUN, 258),
    entry(RUN, 819),
    entry(RUN, 72),
    entry(RUN, 89),
    entry(RUN, 614),
    entry(RUN, 147),
    entry(RUN, 615),
    entry(RUN, 448),
    entry(ONCE, 460),
    entry(ONCE, 714),
    entry(ONCE, 191),
    entry(RUN, 657),
    entry(RUN, 552),
    entry(RUN, 553),
    entry(RUN, 636),
    entry(RUN, 65),
    entry(RUN, 233),
    entry(JEST, 753),
    entry(RUN, 596),
    entry(RUN, 35),
    entry(TSGOLINT, 310),
    entry(RUN, 573),
    entry(RUN, 576),
    entry(ONCE, 462),
    entry(TSGOLINT, 289),
    entry(JEST, 775),
    entry(RUN, 425),
    entry(RUN, 432),
    entry(ONCE, 409),
    entry(RUN, 141),
    entry(JEST, 802),
    entry(RUN, 94),
    entry(RUN, 182),
    entry(RUN, 861),
    entry(RUN, 204),
    entry(RUN, 45),
    entry(ONCE, 857),
    entry(RUN, 658),
    entry(RUN, 87),
    entry(ONCE, 143),
    entry(TSGOLINT, 283),
    entry(RUN, 862),
    entry(RUN, 729),
    entry(RUN, 760),
    entry(RUN, 665),
    entry(RUN, 589),
    entry(RUN, 664),
    entry(TSGOLINT, 255),
    entry(ONCE, 114),
    entry(ONCE, 100),
    entry(RUN, 34),
    entry(RUN, 601),
    entry(ONCE, 806),
    entry(ONCE, 17),
    entry(RUN, 633),
    entry(JEST, 337),
    entry(TSGOLINT, 273),
    entry(RUN, 718),
    entry(ONCE, 485),
    entry(RUN, 180),
    entry(RUN, 227),
    entry(RUN, 835),
    entry(RUN, 441),
    entry(RUN, 267),
    entry(RUN, 43),
    entry(RUN, 80),
    entry(RUN, 113),
    entry(TSGOLINT, 311),
    entry(RUN, 565),
    entry(RUN, 228),
    entry(RUN, 38),
    entry(JEST, 381),
    entry(RUN, 546),
    entry(RUN, 609),
    entry(RUN, 199),
    entry(RUN, 264),
    entry(RUN, 580),
    entry(RUN, 708),
    entry(RUN, 231),
    entry(RUN, 695),
    entry(RUN, 726),
    entry(ONCE, 375),
    entry(RUN, 634),
    entry(RUN, 699),
    entry(ONCE, 703),
    entry(TSGOLINT, 304),
    entry(RUN, 179),
    entry(ONCE, 343),
    entry(RUN, 236),
    entry(RUN, 488),
    entry(RUN, 818),
    entry(ONCE, 15),
    entry(JEST, 809),
    entry(RUN, 698),
    entry(RUN, 543),
    entry(JEST, 387),
    entry(TSGOLINT, 307),
    entry(RUN, 53),
    entry(RUN, 183),
    entry(RUN, 84),
    entry(RUN, 630),
    entry(RUN, 791),
    entry(ONCE, 5),
    entry(ONCE, 784),
    entry(RUN, 88),
    entry(RUN, 376),
    entry(RUN, 820),
    entry(ONCE, 686),
    entry(RUN, 772),
    entry(RUN, 595),
    entry(RUN, 533),
    entry(RUN, 170),
    entry(RUN, 186),
    entry(JEST, 382),
    entry(RUN, 426),
    entry(RUN, 177),
    entry(RUN, 557),
    entry(RUN, 101),
    entry(RUN, 14),
    entry(RUN, 486),
    entry(JEST, 792),
    entry(JEST, 757),
    entry(RUN, 445),
    entry(RUN, 46),
    entry(ONCE, 702),
    entry(RUN, 422),
    entry(RUN, 69),
    entry(RUN, 151),
    entry(RUN, 61),
    entry(RUN, 265),
    entry(ONCE, 397),
    entry(JEST, 770),
    entry(RUN, 247),
    entry(JEST, 335),
    entry(RUN, 483),
    entry(RUN, 201),
    entry(RUN, 123),
    entry(RUN, 649),
    entry(RUN, 298),
    entry(RUN, 866),
    entry(RUN, 340),
    entry(RUN, 295),
    entry(RUN, 56),
    entry(JEST, 741),
    entry(RUN, 51),
    entry(RUN, 494),
    entry(TSGOLINT, 297),
    entry(ONCE, 705),
    entry(RUN, 81),
    entry(RUN, 115),
    entry(RUN, 845),
    entry(RUN, 603),
    entry(ONCE, 173),
    entry(RUN, 568),
    entry(JEST, 357),
    entry(RUN, 670),
    entry(ONCE, 707),
    entry(ONCE, 366),
    entry(RUN, 82),
    entry(JEST, 353),
    entry(RUN, 803),
    entry(RUN, 535),
    entry(RUN, 71),
    entry(JEST, 361),
    entry(RUN, 62),
    entry(RUN, 610),
    entry(ONCE, 172),
    entry(RUN, 399),
    entry(RUN, 139),
    entry(RUN, 532),
    entry(RUN, 659),
    entry(ONCE, 6),
    entry(RUN, 545),
    entry(TSGOLINT, 275),
    entry(RUN, 821),
    entry(ONCE, 454),
    entry(JEST, 804),
    entry(RUN, 789),
    entry(RUN, 489),
    entry(RUN, 539),
    entry(RUN, 735),
    entry(RUN, 406),
    entry(ONCE, 713),
    entry(RUN, 858),
    entry(RUN, 181),
    entry(ONCE, 344),
    entry(ONCE, 750),
    entry(RUN, 131),
    entry(RUN, 421),
    entry(RUN, 843),
    entry(RUN, 220),
    entry(RUN, 683),
    entry(RUN, 190),
    entry(RUN, 627),
    entry(RUN, 496),
    entry(RUN, 99),
    entry(ONCE, 468),
    entry(RUN, 669),
    entry(RUN, 860),
    entry(RUN, 561),
    entry(RUN, 484),
    entry(ONCE, 334),
    entry(RUN, 617),
    entry(RUN, 541),
    entry(RUN, 692),
    entry(JEST, 751),
    entry(ONCE, 211),
    entry(TSGOLINT, 242),
    entry(RUN, 752),
    entry(RUN, 467),
    entry(RUN, 585),
    entry(RUN, 839),
    entry(RUN, 33),
    entry(JEST, 813),
    entry(RUN, 674),
    entry(RUN, 502),
    entry(RUN, 469),
    entry(RUN, 599),
    entry(TSGOLINT, 325),
    entry(RUN, 47),
    entry(ONCE, 672),
    entry(RUN, 11),
    entry(RUN, 418),
    entry(TSGOLINT, 326),
    entry(RUN, 214),
    entry(TSGOLINT, 281),
    entry(RUN, 529),
    entry(RUN, 145),
    entry(RUN, 178),
    entry(ONCE, 4),
    entry(RUN, 687),
    entry(ONCE, 58),
    entry(RUN, 424),
    entry(RUN, 645),
    entry(ONCE, 21),
    entry(RUN, 733),
    entry(ONCE, 9),
    entry(RUN, 68),
    entry(ONCE, 111),
    entry(RUN, 680),
    entry(RUN, 148),
    entry(RUN, 138),
    entry(ONCE, 368),
    entry(RUN, 158),
    entry(RUN, 396),
    entry(RUN, 618),
    entry(RUN, 628),
    entry(RUN, 279),
    entry(TSGOLINT, 280),
    entry(ONCE, 403),
    entry(RUN, 727),
    entry(RUN, 96),
    entry(RUN, 513),
    entry(RUN, 194),
    entry(TSGOLINT, 320),
    entry(RUN, 594),
    entry(JEST, 749),
    entry(TSGOLINT, 254),
    entry(RUN, 663),
    entry(RUN, 12),
    entry(ONCE, 392),
    entry(RUN, 19),
    entry(ONCE, 160),
    entry(RUN, 834),
    entry(ONCE, 215),
    entry(RUN, 825),
    entry(RUN, 401),
    entry(RUN, 299),
    entry(ONCE, 37),
    entry(RUN, 700),
    entry(RUN, 538),
    entry(RUN, 604),
    entry(ONCE, 395),
    entry(RUN, 856),
    entry(RUN, 235),
    entry(RUN, 200),
    entry(JEST, 345),
    entry(RUN, 209),
    entry(RUN, 417),
    entry(JEST, 385),
    entry(RUN, 104),
    entry(RUN, 510),
    entry(RUN, 648),
    entry(RUN, 582),
    entry(ONCE, 3),
    entry(RUN, 10),
    entry(TSGOLINT, 290),
    entry(RUN, 391),
    entry(RUN, 414),
    entry(RUN, 530),
    entry(JEST, 769),
    entry(RUN, 606),
    entry(TSGOLINT, 292),
    entry(RUN, 511),
    entry(RUN, 287),
    entry(RUN, 184),
    entry(ONCE, 457),
    entry(JEST, 372),
    entry(JEST, 774),
    entry(RUN, 574),
    entry(RUN, 149),
    entry(RUN, 49),
    entry(RUN, 666),
    entry(RUN, 520),
    entry(RUN, 107),
    entry(RUN, 667),
    entry(RUN, 498),
    entry(TSGOLINT, 308),
    entry(TSGOLINT, 315),
    entry(RUN, 329),
    entry(TSGOLINT, 314),
    entry(RUN, 52),
    entry(RUN, 130),
    entry(RUN, 632),
    entry(RUN, 696),
    entry(RUN, 230),
    entry(RUN, 293),
    entry(ONCE, 316),
    entry(RUN, 456),
    entry(RUN, 823),
    entry(ONCE, 743),
    entry(ONCE, 405),
    entry(ONCE, 748),
    entry(JEST, 378),
    entry(RUN, 864),
    entry(RUN, 688),
    entry(RUN, 26),
    entry(ONCE, 90),
    entry(ONCE, 327),
    entry(ONCE, 336),
    entry(RUN, 98),
    entry(RUN, 730),
    entry(RUN, 202),
    entry(RUN, 134),
    entry(ONCE, 157),
    entry(RUN, 117),
    entry(ONCE, 758),
    entry(ONCE, 31),
    entry(JEST, 383),
    entry(ONCE, 339),
    entry(RUN, 393),
    entry(JEST, 364),
    entry(RUN, 593),
    entry(RUN, 527),
    entry(RUN, 476),
    entry(RUN, 269),
    entry(RUN, 852),
    entry(ONCE, 815),
    entry(RUN, 18),
    entry(RUN, 195),
    entry(ONCE, 869),
    entry(RUN, 256),
    entry(RUN, 66),
    entry(RUN, 73),
    entry(RUN, 487),
    entry(RUN, 848),
    entry(ONCE, 333),
    entry(RUN, 338),
    entry(RUN, 83),
    entry(RUN, 685),
    entry(RUN, 671),
    entry(RUN, 154),
    entry(RUN, 453),
    entry(RUN, 450),
    entry(ONCE, 152),
    entry(ONCE, 407),
    entry(JEST, 365),
    entry(ONCE, 350),
    entry(ONCE, 755),
    entry(ONCE, 86),
    entry(RUN, 20),
    entry(JEST, 754),
    entry(RUN, 165),
    entry(JEST, 746),
    entry(RUN, 838),
    entry(RUN, 536),
    entry(TSGOLINT, 321),
    entry(RUN, 416),
    entry(ONCE, 144),
    entry(ONCE, 493),
    entry(ONCE, 370),
    entry(RUN, 571),
    entry(RUN, 607),
    entry(RUN, 217),
    entry(ONCE, 108),
    entry(RUN, 828),
    entry(RUN, 219),
    entry(RUN, 499),
    entry(RUN, 506),
    entry(RUN, 673),
    entry(JEST, 793),
    entry(RUN, 836),
    entry(RUN, 221),
    entry(RUN, 711),
    entry(ONCE, 106),
    entry(RUN, 79),
    entry(TSGOLINT, 284),
    entry(RUN, 558),
    entry(RUN, 249),
    entry(TSGOLINT, 277),
    entry(RUN, 728),
    entry(TSGOLINT, 252),
    entry(RUN, 579),
    entry(RUN, 438),
    entry(RUN, 643),
    entry(RUN, 850),
    entry(JEST, 807),
    entry(TSGOLINT, 276),
    entry(RUN, 519),
    entry(RUN, 559),
    entry(RUN, 592),
    entry(RUN, 608),
    entry(TSGOLINT, 288),
    entry(RUN, 189),
    entry(RUN, 661),
    entry(RUN, 491),
    entry(JEST, 805),
    entry(RUN, 556),
    entry(RUN, 208),
    entry(TSGOLINT, 245),
    entry(TSGOLINT, 301),
    entry(RUN, 150),
    entry(ONCE, 472),
    entry(TSGOLINT, 296),
    entry(RUN, 523),
    entry(JEST, 795),
    entry(RUN, 410),
    entry(RUN, 635),
    entry(ONCE, 470),
    entry(TSGOLINT, 322),
    entry(RUN, 719),
    entry(TSGOLINT, 262),
    entry(RUN, 39),
    entry(RUN, 23),
    entry(ONCE, 331),
    entry(RUN, 509),
    entry(ONCE, 497),
    entry(RUN, 120),
    entry(JEST, 812),
    entry(RUN, 495),
    entry(RUN, 193),
    entry(RUN, 244),
    entry(RUN, 478),
    entry(RUN, 732),
    entry(RUN, 570),
    entry(RUN, 97),
    entry(RUN, 171),
    entry(RUN, 226),
    entry(RUN, 216),
    entry(RUN, 455),
    entry(JEST, 773),
    entry(RUN, 260),
    entry(RUN, 420),
    entry(JEST, 367),
    entry(RUN, 642),
    entry(ONCE, 747),
    entry(RUN, 490),
    entry(RUN, 841),
    entry(RUN, 402),
    entry(RUN, 159),
    entry(ONCE, 28),
    entry(RUN, 712),
    entry(ONCE, 394),
    entry(RUN, 433),
    entry(RUN, 837),
    entry(ONCE, 434),
    entry(ONCE, 742),
    entry(RUN, 461),
    entry(RUN, 63),
    entry(RUN, 212),
    entry(RUN, 662),
    entry(RUN, 13),
    entry(ONCE, 465),
    entry(RUN, 146),
    entry(RUN, 540),
    entry(RUN, 551),
    entry(ONCE, 188),
    entry(RUN, 693),
    entry(RUN, 600),
    entry(RUN, 722),
    entry(JEST, 745),
    entry(JEST, 794),
    entry(RUN, 725),
    entry(TSGOLINT, 268),
    entry(JEST, 771),
    entry(RUN, 210),
    entry(RUN, 24),
    entry(TSGOLINT, 291),
    entry(RUN, 175),
    entry(RUN, 870),
    entry(TSGOLINT, 272),
    entry(RUN, 534),
    entry(RUN, 93),
    entry(RUN, 85),
    entry(RUN, 121),
    entry(RUN, 516),
    entry(RUN, 129),
    entry(RUN, 639),
    entry(RUN, 549),
    entry(RUN, 597),
    entry(ONCE, 759),
    entry(RUN, 736),
    entry(RUN, 816),
    entry(RUN, 118),
    entry(JEST, 799),
    entry(ONCE, 223),
    entry(RUN, 522),
    entry(RUN, 477),
    entry(RUN, 629),
    entry(JEST, 767),
    entry(RUN, 50),
    entry(ONCE, 7),
    entry(RUN, 701),
    entry(RUN, 562),
    entry(RUN, 654),
    entry(RUN, 237),
    entry(TSGOLINT, 324),
    entry(RUN, 238),
    entry(RUN, 442),
    entry(RUN, 827),
    entry(ONCE, 808),
    entry(ONCE, 716),
    entry(ONCE, 842),
    entry(ONCE, 786),
    entry(RUN, 547),
    entry(ONCE, 354),
    entry(TSGOLINT, 243),
    entry(RUN, 413),
    entry(RUN, 122),
    entry(RUN, 868),
    entry(RUN, 591),
    entry(RUN, 76),
    entry(RUN, 647),
    entry(JEST, 380),
    entry(RUN, 415),
    entry(TSGOLINT, 222),
    entry(RUN, 626),
    entry(TSGOLINT, 328),
    entry(RUN, 503),
    entry(RUN, 125),
    entry(RUN, 587),
    entry(TSGOLINT, 312),
    entry(RUN, 814),
    entry(RUN, 132),
    entry(RUN, 373),
    entry(ONCE, 64),
    entry(RUN, 824),
];
