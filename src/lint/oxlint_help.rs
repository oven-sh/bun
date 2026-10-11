//! What oxlint says besides the message of a diagnostic: its `help`, its `note`, and what it says at the place.
//!
//! Made from what oxlint 1.87 prints for the cases of the test suites, each paired with what `bun lint` reports at the same place: an
//! entry is the text of oxlint in which the values that the rule gives to [`Report::data`](crate::context::Report::data) are
//! replaced by their names, if that makes the text of all the pairs with that message, letter for letter.

use self::Edits::{All, First};
use self::Texts::{One, Three};
use crate::rule::{Message, Meta};
use bun_core::strings;
use std::num::NonZeroU32;

/// What the table has for a message.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Help(NonZeroU32);

/// Which text of a diagnostic.
#[derive(Copy, Clone)]
pub(crate) enum Part {
    Help,
    /// What is said at the place of the report.
    FirstLabel,
    Note,
}

#[derive(Copy, Clone)]
pub(crate) enum Found {
    Nothing,
    Constant(&'static str),
    /// With `{{names}}`.
    WithData(&'static str),
    /// oxlint has no help of its own, and says what its `RuleFixer` says about the fix. `removes`: of a replacement by nothing that
    /// is "Remove `..`.", and not "Delete this code.".
    OfTheFix {
        removes: bool,
        edits: Edits,
    },
}

/// Of which edits of a fix oxlint speaks.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Edits {
    /// Its fix has several too, and it says what it says about the first.
    First,
    /// It makes one, which does what all of them do.
    All,
}

impl Help {
    fn texts(self) -> Option<Texts> {
        Some(INDEX.get(self.0.get() as usize - 1)?.1)
    }

    pub(crate) fn found(self, part: Part) -> Found {
        let [help, first_label, note] = match (self.texts(), part) {
            (Some(One(help)), _) => [help, "", ""],
            (Some(Three(all)), _) => *all,
            (Some(Texts::OfTheFix { removes, edits, .. }), Part::Help) => {
                return Found::OfTheFix { removes, edits };
            }
            (Some(Texts::OfTheFix { note, .. }), _) => ["", "", note],
            (None, _) => [""; 3],
        };
        let text = match part {
            Part::Help => help,
            Part::FirstLabel => first_label,
            Part::Note => note,
        };
        match text.is_empty() {
            true => Found::Nothing,
            false if strings::contains(text.as_bytes(), b"{{") => Found::WithData(text),
            false => Found::Constant(text),
        }
    }

    /// The text, if it is one without values. Else "".
    pub(crate) fn constant(self, part: Part) -> &'static str {
        match self.found(part) {
            Found::Constant(text) => text,
            _ => "",
        }
    }

    /// One of the texts has values in it.
    pub(crate) fn has_values(self) -> bool {
        [Part::Help, Part::FirstLabel, Part::Note]
            .into_iter()
            .any(|part| matches!(self.found(part), Found::WithData(_)))
    }

    /// The help is [`Found::OfTheFix`].
    pub(crate) fn is_of_the_fix(self) -> bool {
        matches!(self.texts(), Some(Texts::OfTheFix { .. }))
    }
}

/// What there is for `message`, which is as oxlint says it, of `rule`.
pub(crate) fn of(rule: &Meta, message: Message) -> Option<Help> {
    let key = rule.key ^ message.key.rotate_left(16);
    let at = INDEX.binary_search_by_key(&key, |it| it.0).ok()?;
    NonZeroU32::new(at as u32 + 1).map(Help)
}

#[derive(Copy, Clone)]
enum Texts {
    /// The help.
    One(&'static str),
    /// The help, what is said at the place of the report, the note. "": there is none.
    Three(&'static [&'static str; 3]),
    /// [`Found::OfTheFix`], and the note.
    OfTheFix {
        removes: bool,
        edits: Edits,
        note: &'static str,
    },
}

const fn of_the_fix(removes: bool, edits: Edits, note: &'static str) -> Texts {
    Texts::OfTheFix {
        removes,
        edits,
        note,
    }
}

/// Sorted by the key, which is made of `Meta::key` and `Message::key`.
#[rustfmt::skip]
static INDEX: &[(u32, Texts)] = &[
    (0x0060F26E, One("Prefer explicitly defining any function parameters and return type.")), // no-unsafe-function-type bannedFunctionType
    (0x00794F6C, of_the_fix(false, First, "")), // prefer-to-be-falsy
    (0x0080189E, One("Rename the function or the variable/property so the names satisfy this rule.")), // func-name-matching matchProperty
    (0x009D1FB0, One("Replace the computed property with a plain identifier or string literal")), // no-useless-computed-key unnecessarilyComputedProperty
    (0x00B328BB, Three(&["Use `.at()` for index access.", "", "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/at"])), // prefer-at
    (0x00D239E9, One("Do not use CommonJS `require` calls and `module.exports` or `exports.*`")), // no-commonjs
    (0x00F6B325, Three(&["Do not re-assign a function declared as a FunctionDeclaration.", "{{name}} is re-assigned here", ""])), // no-func-assign isAFunction
    (0x0118BF96, Three(&["Use a static property key, or use a Map/Set for dynamic keys.", "", "Frequent property deletions can move objects to slower dictionary-mode properties and hurt inline-cache optimizations. See: https://v8.dev/blog/fast-properties."])), // no-dynamic-delete dynamicDelete
    (0x0123C577, Three(&["", "Default clause should be the last clause.", ""])), // default-case-last notLast
    (0x01B12D02, One("Make sure there is an empty new line before the {{name}} block")), // padding-around-test-blocks
    (0x01D7F018, One("See https://nextjs.org/docs/messages/next-script-for-ga")), // next-script-for-ga
    (0x01DC3163, One("Rename '{{name}}' to avoid shadowing the global property.")), // no-shadow-restricted-names shadowingRestrictedName
    (0x01E6B38E, One("Add description comment to `@returns` tag.")), // require-returns-description
    (0x02275BCC, One("Consider renaming '{{name}}' to avoid shadowing the global variable.")), // no-shadow noShadowGlobal
    (0x02FE0566, One("The first argument to an error constructor should be a string describing the error.")), // error-message
    (0x040964C8, One("File must begin with the Unicode BOM")), // unicode-bom expected
    (0x053BAE70, One("Consider passing a function.")), // no-implied-eval noImpliedEvalError
    (0x058AAB56, One("Use template literals instead of string concatenation.")), // prefer-template unexpectedStringConcatenation
    (0x05C2ED19, One("Consider using a utility function or a class that extends the built-in object instead of defining properties on the prototype.")), // no-extend-native unexpected
    (0x061995FF, One("You can try to fix this by turning on the `noImplicitThis` compiler option, or adding a `this` parameter to the function.")), // no-unsafe-assignment anyAssignmentThis
    (0x0687884C, One("Move the property into the object initializer.")), // no-immediate-mutation
    (0x06EAECE6, One("Replace conditionals with separate test cases for each branch to keep tests deterministic and easy to understand.")), // no-conditional-in-test
    (0x071D498B, One("Use either promises or callbacks exclusively for handling asynchronous code.")), // no-promise-in-callback
    (0x07C91B4B, One("You can import anything except `suite, test, chai, describe, it, expectTypeOf, assertType, expect, assert, vitest, vi, beforeAll, afterAll, beforeEach, afterEach, onTestFailed, onTestFinished`.")), // no-importing-vitest-globals
    (0x07D3DAF0, One("Avoid matching control characters in regular expressions. If intentional, disable this rule for the expression.")), // no-control-regex unexpected
    (0x0811C395, One("Did you mean to use `Object.fromEntries(map)` instead?")), // no-misused-spread noMapSpreadInObject
    (0x0858A4B1, One("Consider assigning the import to a variable or removing it if it's unused.")), // no-unassigned-import
    (0x0872DEF5, One("Replace index check with strict equality check")), // consistent-existence-index-check
    (0x08A9ECAE, One("Consider removing `undefined` or using `null` instead.")), // no-useless-undefined
    (0x08D1BD39, One("Define a getter for this property")), // accessor-pairs missingGetterInPropertyDescriptor
    (0x0905D05C, One("Remove the self-assignment or assign to a different variable.")), // no-self-assign selfAssignment
    (0x091A0342, One("Replace `.innerText` with `.textContent`.")), // prefer-dom-node-text-content
    (0x092B0E10, One("Remove the parameter modifier and declare this member on the class instead.")), // parameter-properties preferClassProperty
    (0x0947BAC4, One("Use the actual character or a valid escape sequence instead.")), // no-nonoctal-decimal-escape decimalEscape
    (0x09DA5F90, One("Operands must both be a number or both be {{stringLike}}.")), // restrict-plus-operands mismatched
    (0x0A513778, Three(&["", "", "Named default exports improve grepability and enable consistent auto-imports across the codebase."])), // no-anonymous-default-export
    (0x0AAD4A16, of_the_fix(false, First, "")), // sort-keys sortKeys
    (0x0AB65693, One("Remove usage of `process.env`.")), // no-process-env
    (0x0B3AFDA4, of_the_fix(false, First, "")), // prefer-string-starts-ends-with
    (0x0B4075BA, One("Use a `break` statement to prevent fallthrough, or add a comment to indicate intentional fallthrough.")), // no-fallthrough default
    (0x0BA721AE, One("Rename the function or the variable/property so the names satisfy this rule.")), // func-name-matching matchVariable
    (0x0BD4ACB3, One("Replace `as {{cast}}` with `<{{cast}}>`. For example, change `value as {{cast}}` to `<{{cast}}>value`.")), // consistent-type-assertions angle-bracket
    (0x0C0D2A86, One("Use a bigint literal (e.g. `123n`) instead of calling `BigInt` with a literal argument.")), // prefer-bigint-literals
    (0x0C2B5AB6, One("Did you mean `{{suggestion}}`?")), // misrefactored-assign-op
    (0x0C79C256, One("add rel=`noreferrer` or rel=`noopener` to the element")), // jsx-no-target-blank
    (0x0C91E0A2, One("File must not begin with the Unicode BOM")), // unicode-bom unexpected
    (0x0CAEE6D8, One("Do not use the comma operator. If you intended to write a sequence, wrap it in parentheses.")), // no-sequences unexpectedCommaExpression
    (0x0CC03201, Three(&["Using default numerical values for enum members can cause bugs later on if the enum is modified. Instead give \"{{name}}\" an explicit initializer (for example `= 0` or `= '{{name}}'`).", "", "TypeScript computes uninitialized enum members as numbers: the first one defaults to `0`, and each following uninitialized member is the previous numeric value plus `1`."])), // prefer-enum-initializers defineInitializer
    (0x0CFAB60A, of_the_fix(false, First, "")), // prefer-includes
    (0x0D14EA50, One("Remove one of the props, or rename them so each prop is distinct.")), // jsx-no-duplicate-props
    (0x0D7DC07F, One("Use `<></>` instead of `<React.Fragment></React.Fragment>`.")), // jsx-fragments
    (0x0D8D8E11, One("Consider adding an explicit return type annotation if the function is intended to return a union of promise and non-promise types.")), // promise-function-async missingAsyncHybridReturn
    (0x0E0355F8, One("@property `{{type_name}}` is duplicated on the same block.")), // check-property-names
    (0x0E05869C, One("Use the `isNaN` function instead of the switch.")), // use-isnan switchNaN
    (0x0E386427, One("Avoid eval(). For JSON parsing use JSON.parse(); for dynamic property access use bracket notation (obj[key]); for other cases refactor to avoid evaluating strings as code.")), // no-eval unexpected
    (0x0E538FD3, One("\"prefer use Jest own API `{{api}}`\"")), // no-jasmine-globals
    (0x0E83665F, One("Ensure the label either has text inside it or is accessibly labelled using an attribute such as `aria-label`, or `aria-labelledby`. You can mark more attributes as accessible labels by configuring the `labelAttributes` option.")), // label-has-associated-control
    (0x0E927D39, One("Use a `break` statement to prevent fallthrough, or add a comment to indicate intentional fallthrough.")), // no-fallthrough case
    (0x0F2D3BB6, One("Add description comment to `@yields` tag.")), // require-yields-description
    (0x0F38A7FF, One("Remove the `.bind` call.")), // no-extra-bind unexpected
    (0x0F58F8C1, One("You can try to fix this by turning on the `noImplicitThis` compiler option, or adding a `this` parameter to the function.")), // no-unsafe-call unsafeCallThis
    (0x0FD049B8, One("Refactor nested ternary expressions into if-else statements for better readability.")), // no-nested-ternary noNestedTernary
    (0x0FF43A4D, One("Move the file to the same directory, use dependency injection, or convert to a package.")), // no-relative-parent-imports
    (0x10142F89, One("Preserve the original error by using the `cause` property when re-throwing errors.")), // preserve-caught-error partiallyLostError
    (0x101D918F, Three(&["Use a different variable name instead of re-assigning the class declaration.", "{{name}} is declared as class here", ""])), // no-class-assign class
    (0x105BB692, One("Replace this default export with a named export.")), // no-default-export
    (0x106D3C17, One("Remove the 'public' modifier. Members are public by default, so the modifier is redundant.")), // explicit-member-accessibility unwantedPublicAccessibility
    (0x108B4503, One("Declare the variable if it is intended to be local.")), // no-implicit-globals globalVariableLeak
    (0x10EC629D, of_the_fix(false, First, "")), // prefer-to-be
    (0x10FCE172, Three(&["Convert the class component to a function component.", "", "See https://react.dev/reference/react/Component#migrating-a-simple-component-from-a-class-to-a-function"])), // prefer-function-component
    (0x1140A6BB, One("Rename the parameter to avoid shadowing the global `expect`.")), // prefer-expect-assertions
    (0x116D0C7B, of_the_fix(false, First, "")), // prefer-to-be
    (0x11DDDB46, One("Consider using [Symbol.iterator] instead")), // no-iterator noIterator
    (0x1237F276, One("Give `aria-labelledby` an ID to a label element. Prefer the `alt` attribute over `aria-labelledby` for images.")), // alt-text
    (0x12425C48, One("Add a `displayName` property to the component.")), // display-name
    (0x124AB7BF, One("Require grouped accessor pairs in object literals and classes")), // grouped-accessor-pairs notGrouped
    (0x12D3E40B, One("Use a regular function or method shorthand instead of an arrow function.")), // no-arrow-functions-in-watch
    (0x12D67E80, of_the_fix(false, First, "")), // prefer-string-slice
    (0x131E6446, One("Must have `alt` prop, either with meaningful text, or an empty string for decorative images.")), // alt-text
    (0x1331A7D3, One("Wrapping the error in `Promise.reject` is needlessly verbose. All errors thrown in async functions are already wrapped in a `Promise`.")), // no-useless-promise-resolve-reject
    (0x13B134F0, Three(&["Remove the duplicate `super()` call", "This path may call `super()` after it was already called.", ""])), // constructor-super duplicate
    (0x144B9C52, One("Define a getter for this property")), // accessor-pairs missingGetterInClass
    (0x144D600D, of_the_fix(false, First, "")), // prefer-to-be-truthy
    (0x1481816A, One("if `{{rhs_str}}` evaluates to true, `{{lhs_str}}` will always evaluate to true as well")), // const-comparisons
    (0x14BA2452, One("Imported bindings are readonly")), // no-import-assign readonlyMember
    (0x14C236C5, One("`addEventListener()` can register multiple handlers and accepts options such as `{ once: true }`; assigning to `on<event>` replaces any previously registered handler.")), // prefer-add-event-listener
    (0x153734AE, One("See https://nextjs.org/docs/messages/google-font-display")), // google-font-display
    (0x155E8E4F, One("Add a `timeout` property to the options object.")), // require-test-timeout
    (0x1582E15B, One("See https://nextjs.org/docs/messages/no-head-import-in-document")), // no-head-import-in-document
    (0x15F11F3B, One("Define an explicit argument type for each argument.")), // explicit-module-boundary-types missingArgTypeUnnamed
    (0x1600E77C, One("Consider revising the pattern to remove or relocate the backreference so it points to a group that can be matched at the time of evaluation.")), // no-useless-backreference backward
    (0x162D2C2C, One("`@property` path declaration `{{x1}}` appears before any real property.")), // check-property-names
    (0x162E6ADB, One("Use `module.exports` instead.")), // exports-style
    (0x16A58B57, One("Specify the rules you want to disable.")), // no-abusive-eslint-disable
    (0x16C210C0, One("Consider splitting it into smaller functions.")), // max-statements exceed
    (0x16FCD447, One("add rel=`noreferrer` to the element")), // jsx-no-target-blank
    (0x1716694C, One("Refactor to use an `async` function with `await` instead of passing callbacks for cleaner error handling and control flow.")), // prefer-await-to-callbacks
    (0x17DA8860, One("The instanceof Array check doesn't work across realms/contexts, for example, frames/windows in browsers or the vm module in Node.js.")), // no-instanceof-array
    (0x18610854, of_the_fix(false, First, "")), // prefer-to-contain
    (0x187F550D, of_the_fix(false, All, "")), // array-type errorStringGeneric
    (0x18A66ABB, One("Use `resolve()` or `reject()` instead of returning a value.")), // no-promise-executor-return returnsValue
    (0x1905F47D, One("You can try to fix this by turning on the `noImplicitThis` compiler option, or adding a `this` parameter to the function.")), // no-unsafe-call errorCallThis
    (0x193E14CD, Three(&["", "", "Named default exports improve grepability and enable consistent auto-imports across the codebase."])), // no-anonymous-default-export
    (0x193FD901, One("Give `aria-label` a meaningful value. Prever the `alt` attribute over `aria-label` for images.")), // alt-text
    (0x19959635, One("Wrap it in a block or in an IIFE.")), // no-implicit-globals globalLexicalBinding
    (0x19B15CBB, One("Refactor your code to use `for` loops instead.")), // no-array-reduce
    (0x1A128CDC, One("Refactor so that promises are chained in a flat manner.")), // no-nesting
    (0x1A840B64, One("Remove the redundant nested block statement.")), // no-lone-blocks redundantNestedBlock
    (0x1A9B3FED, One("`new Buffer()` is deprecated, use `Buffer.alloc()` or `Buffer.from()` instead.")), // no-new-buffer
    (0x1A9EEA9F, One("Did you forget to wrap `expect` in a `test` or `it` block?")), // no-standalone-expect
    (0x1AB19EE9, One("Group digits with numeric separators (_) so longer numbers are easier to read.")), // numeric-separators-style
    (0x1AB2D2B4, One("Either define '{{name}}' or remove the reference to it. If '{{name}}' is a global variable, add it to the 'globals' configuration.")), // no-undef undef
    (0x1B0CC963, Three(&["Replace `module` with `namespace` for internal declarations.", "", "`module` for internal declarations is no longer supported: treat it as a hard error. Expect it to become a parse error in a future version of TypeScript and Oxlint. See: https://github.com/microsoft/TypeScript/issues/54500, https://github.com/microsoft/TypeScript/issues/62211, https://github.com/microsoft/TypeScript/pull/62876."])), // prefer-namespace-keyword useNamespace
    (0x1B3387A4, One("Updating state after a component mount triggers a second render() call and can lead to property/layout thrashing.")), // no-did-mount-set-state
    (0x1B56DF94, One("Consider using this expression or removing it")), // no-unused-expressions unusedExpression
    (0x1BB099A0, One("Make sure there is an empty new line before the afterAll block")), // padding-around-after-all-blocks
    (0x1BD891E7, One("Using default import as {{module_name}} can be confusing. Use another name for default import to avoid confusion.")), // no-named-as-default
    (0x1C50F8CB, One("Rename the function or the variable/property so the names satisfy this rule.")), // func-name-matching notMatchVariable
    (0x1CB82C2D, One("Move the returned value to be immediately after the `=>`.")), // arrow-body-style unexpectedObjectBlock
    (0x1D322BFB, One("Change to `throw new TypeError(...)`")), // prefer-type-error
    (0x1D83871A, One("Replace this `void` type with an allowed type, or keep `void` only in a valid return position.")), // no-invalid-void-type invalidVoidNotReturnOrThisParam
    (0x1E244682, Three(&["Change `EventEmitter` to `EventTarget`. EventEmitters are only available in Node.js, while EventTargets are also available in browsers.", "", "https://developer.mozilla.org/en-US/docs/Web/API/EventTarget"])), // prefer-event-target
    (0x1E4D2974, One("If an object is defined as 'thenable', once it's accidentally used in an await expression, it may cause problems")), // no-thenable
    (0x1EEBBE80, One("Replace with `toHaveBeenCalledExactlyOnceWith` and remove redundant expect")), // prefer-called-exactly-once-with
    (0x1F7FDA40, One("Avoid matching control characters in regular expressions. If intentional, disable this rule for the expression.")), // no-control-regex unexpected
    (0x1F90CE4A, One("Assign the result of the await expression to a variable, then access the member from that variable.")), // no-await-expression-member
    (0x1FAC619A, One("Use a more robust iteration method such as for-of or array.forEach instead.")), // no-for-in-array forInViolation
    (0x20D05EE5, One("Require all enum members to be literal values.")), // prefer-literal-enum-member notLiteral
    (0x21748555, One("Replace `Math.pow(a, b)` with `a ** b`.")), // prefer-exponentiation-operator useExponentiation
    (0x2181B206, Three(&["", "this parameter can be unified", ""])), // unified-signatures singleParameterDifference
    (0x2205CF93, One("Use the `isNaN` function to compare with NaN.")), // use-isnan comparisonWithNaN
    (0x226B3AAC, One("Assign the result of 'new' to a variable or compare it to a reference.")), // no-new noNewStatement
    (0x22B2BA85, One("To avoid confusion around the {} type allowing any non-nullish value, this rule bans usage of the {} type.")), // no-empty-object-type noEmptyInterfaceWithSuper
    (0x24487926, One("Add `await` to the `expect.{{member_name}}` call.")), // require-awaited-expect-poll
    (0x244A0CCB, One("Omit the argument to delete all elements after the start index.")), // no-unnecessary-array-splice-count
    (0x2481EB1F, One("Replace `arguments` with rest parameters (`...args`).")), // prefer-rest-params preferRestParams
    (0x248A8A81, One("Replace `{{deprecated}}` with `{{replacement}}`.")), // no-deprecated-destroyed-lifecycle
    (0x24AD54E2, One("Use a function declaration instead.")), // no-deprecated-data-object-declaration
    (0x24E68FCA, of_the_fix(false, First, "")), // prefer-to-be
    (0x250F790D, One("Prefer using \"{{preferred_method}}\" instead of \"{{other_method}}\"{{within}}")), // consistent-test-it
    (0x25AAA242, One("Consider revising the pattern to remove or relocate the backreference so it points to a group that can be matched at the time of evaluation.")), // no-useless-backreference nested
    (0x25ADCBD5, One("The body of a for-in should be wrapped in an if statement to filter unwanted properties from the prototype.")), // guard-for-in wrap
    (0x25AF89B7, One("It's not clear whether the argument is meant to be the length of the array or the only element. If the argument is the array's length, consider using `Array.from({ length: n })`. If the argument is the only element, use `[element]`.")), // no-new-array
    (0x25B6FA93, Three(&["Wrap the async handler and forward errors to `next()` (e.g. `(req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)`).\nExpress does not automatically handle rejected promises from async handlers, which results in unhandled promise rejections and server crashes.", "", "If you're on Express 5, disable this rule. To allow specific functions, add their names to `allowedNames`."])), // no-async-endpoint-handlers
    (0x25EE7DEF, One("Compare enum values to members of the same enum, or convert both sides to the same primitive type before comparing them.")), // no-unsafe-enum-comparison mismatchedCondition
    (0x2602EF24, One("Throw the value being passed into Promise.reject instead")), // no-return-wrap
    (0x266406B4, of_the_fix(false, First, "")), // text-encoding-identifier-case
    (0x2692F915, One("add rel=`noreferrer` to the element")), // jsx-no-target-blank
    (0x26B202C5, One("Rewrite `/=` into `/[=]`")), // no-div-regex unexpected
    (0x26F06D05, One("See https://nextjs.org/docs/messages/no-before-interactive-script-outside-document")), // no-before-interactive-script-outside-document
    (0x26FFE9DE, One("Move the shared code outside the `if` statement to reduce code duplication")), // branches-sharing-code
    (0x279AAA40, One("Remove the duplicate dependency from the array.")), // exhaustive-deps
    (0x27F9437A, One("Move the shared code outside the `if` statement to reduce code duplication")), // branches-sharing-code
    (0x28285BAA, Three(&["Consider importing directly from the specific modules instead of using `export *` or `import *`.\nLoading {{total}} modules may be slow for runtimes and bundlers.", "", "See: https://marvinh.dev/blog/speeding-up-javascript-ecosystem-part-7"])), // no-barrel-file
    (0x287E3094, One("Remove this property access, or remove `{{method_kind}}` from the method")), // no-accessor-recursion
    (0x28AF844A, One("Rename the function or the variable/property so the names satisfy this rule.")), // func-name-matching notMatchProperty
    (0x28B8D6A6, One("Remove the `new` operator to call `{{name}}` as a function.")), // no-new-native-nonconstructor noNewNonconstructor
    (0x28EF0ABD, One("Pass a description argument to the Symbol()")), // symbol-description expected
    (0x28F15987, of_the_fix(false, First, "")), // prefer-to-be
    (0x2905BD12, One("Move absolute import above relative import")), // first
    (0x2914DD32, of_the_fix(false, First, "")), // no-blank-blocks
    (0x2936D5DD, One("Imported bindings are readonly")), // no-import-assign readonly
    (0x294AC64D, One("Reference `this` directly instead of assigning it to a variable.")), // no-this-assignment
    (0x29E0C363, One("Consider using a `for...of` loop for this simple iteration.")), // prefer-for-of preferForOf
    (0x2A0567C6, One("Move the elements from `{{method}}()` into the array initializer.")), // no-immediate-mutation
    (0x2A194A9C, One("`expose` should be called synchronously in `setup()` (or `defineExpose()` in `<script setup>`). Move the call before the first `await`.")), // no-expose-after-await
    (0x2A383EE8, One("The `arguments` object does not have a `{{method_name}}()` method. If you intended to use an array method, consider using rest parameters instead or converting the `arguments` object to an array.")), // bad-array-method-on-arguments
    (0x2A40F8AD, One("Because `{{left}}` will {{how_often}} be {{relation}} itself")), // const-comparisons
    (0x2A64055F, Three(&["The last declaration overwrites previous ones, remove one of them or rename if both should be retained", "\"{{name}}\" is previously declared here", ""])), // no-dupe-class-members unexpected
    (0x2AB32820, One("Avoid using ambiguous text like \"{{text}}\", replace it with more descriptive text that provides context.")), // anchor-ambiguous-text
    (0x2B1406AF, Three(&["Merge the duplicated exports into a single export statement", "This export is duplicated", ""])), // no-duplicate-imports export
    (0x2B87867E, Three(&["", "this signature can be unified", ""])), // unified-signatures allParametersAreSame
    (0x2C48190F, of_the_fix(false, First, "")), // no-useless-escape unnecessaryEscape
    (0x2D0C060F, One("Add `tabIndex={0}` or `tabIndex={-1}` to make the element focusable.")), // interactive-supports-focus
    (0x2D97980B, One("Use a non-negative numeric literal for the timeout value.")), // require-test-timeout
    (0x2D97C338, One("Remove `await` if the value is synchronous, or change the expression to return a Promise or Thenable before awaiting it.")), // await-thenable await
    (0x2DB8429D, One("Replace this argument with a numeric literal.")), // prefer-expect-assertions
    (0x2E0DDD90, One("Use event handlers instead if you can.")), // jsx-no-script-url
    (0x2EBC678D, One("Do not use spread arguments when calling slot functions.")), // no-multiple-slot-args
    (0x2EC5DBD1, Three(&["Replace the object literal type assertion with a type annotation. For example, change `const x = { a: 1 } as Type` to `const x: Type = { a: 1 }`. Alternatively, use `const x = { a: 1 } satisfies Type` if you want TypeScript to infer the exact shape.", "", "Type assertions on object literals can hide errors where the object doesn't actually match the asserted type. Using type annotations or `satisfies` ensures TypeScript verifies that the object matches the expected type."])), // consistent-type-assertions unexpectedObjectTypeAssertion
    (0x2F10E46A, One("Require or disallow initialization in variable declarations")), // init-declarations notInitialized
    (0x2F2BBEA6, One("Do not use the `with` statement.")), // no-with unexpectedWith
    (0x2F4F170A, One("Remove the surrounding if statement.")), // no-conditional-tests
    (0x2F8E0659, One("Replace this readonly literal field with a getter.")), // class-literal-property-style preferGetterStyle
    (0x2FD0D405, One("Try to remove invalid attribute `{{attr_name}}`.")), // role-supports-aria-props
    (0x302217C2, of_the_fix(false, First, "")), // prefer-to-be
    (0x305AA56F, One("Replace `{{current_property}}` with `{{replacement}}`.")), // prefer-mock-return-shorthand
    (0x30A935DC, One("Rename the file that match the pattern {{pattern}}")), // consistent-test-filename
    (0x30DA2BE4, One("Change `{{autocomplete}}` to a valid value for `autocomplete`.")), // autocomplete-valid
    (0x30F77694, One("Consider splitting it into smaller functions.")), // max-lines-per-function exceed
    (0x31064F33, One("Add `await` to your assertion.")), // valid-expect
    (0x313E1D6C, One("See: https://nextjs.org/docs/messages/no-async-client-component")), // no-async-client-component
    (0x31815129, One("Const enums are not supported by bundlers and are incompatible with the isolatedModules mode. Their use can lead to import nonexistent values (because const enums are erased).")), // no-const-enum
    (0x323049FB, One("The TypeScript compiler doesn't check whether properties are initialized, which can lead to TypeScript not detecting code that will cause runtime errors.")), // no-unsafe-declaration-merging unsafeMerging
    (0x32A4602D, One("combine all events into a single `defineEmits` call.")), // valid-define-emits
    (0x32F34167, One("Prefer `node:{{module_name}}` over `{{module_name}}`.")), // prefer-node-protocol
    (0x331EE56D, One("Surround the arrow body with braces and use a return statement.")), // arrow-body-style expectedBlock
    (0x338A21D2, of_the_fix(false, First, "")), // prefer-to-have-length
    (0x33ADF728, One("Switch to `Set`")), // prefer-set-has
    (0x345D4F08, One("Enforce default parameters to be last.")), // default-param-last shouldBeLast
    (0x3491E50F, One("Use `for...of` for synchronous iterables, or change the iterable to implement `Symbol.asyncIterator`.")), // await-thenable forAwaitOfNonAsyncIterable
    (0x35A40854, One("Add members to this interface, or use a type alias if it is intentionally empty.")), // no-empty-interface noEmpty
    (0x367988B3, One("Assign `undefined` to the variable instead of using `delete`. The `delete` operator is intended for removing properties from objects, not for variables.")), // no-delete-var unexpected
    (0x372F35A2, One("Use `.at()` for index access.")), // prefer-at
    (0x37356D1D, One("Replace `.apply()` with spread syntax (`...args`).")), // prefer-spread preferSpread
    (0x37359BE4, One("Use {{kind}} destructuring rather than direct member access.")), // prefer-destructuring preferDestructuring
    (0x37441D54, One("Add `@yields` tag to the JSDoc comment.")), // require-yields
    (0x37A179DC, One("It's better to make it clear what the value of the digits argument is when calling Number#toFixed(), instead of relying on the default value of 0.")), // require-number-to-fixed-digits-argument
    (0x38375F1D, Three(&["`React.Children` is uncommon and leads to fragile React components.", "", "https://react.dev/reference/react/Children#alternatives"])), // no-react-children
    (0x38AA9EA3, One("When using JSX, `<a />` expands to `React.createElement(\"a\")`. Therefore the `React` variable must be in scope.")), // react-in-jsx-scope
    (0x38F375BE, One("Provide screen reader accessible content when using heading elements.")), // heading-has-content
    (0x39372F2F, One("Define a getter for this property")), // accessor-pairs missingGetterInObjectLiteral
    (0x39763B2A, One("Prefer {{expectedOperator}} operator")), // eqeqeq unexpected
    (0x39B8CC08, One("Use `indexOf(value)` instead of `findIndex(x => x === value)` for better clarity and performance")), // prefer-array-index-of
    (0x39DAC322, One("Replace second argument with a function")), // valid-describe-callback
    (0x3A0B6013, One("There should be no spaces or new lines inside a pair of empty braces as it affects the overall readability of the code.")), // empty-brace-spaces
    (0x3A63C3F6, One("Remove the name on this function expression.")), // func-names named
    (0x3A6CD864, One("Remove the `async` keyword from the Promise executor function.")), // no-async-promise-executor async
    (0x3A9AE125, One("{{customMessage}}")), // no-restricted-imports patternAndImportNameWithCustomMessage
    (0x3B71AA53, One("Replace the number literal with `{{lit}}`")), // no-zero-fractions
    (0x3BC6501C, One("Remove the literal from the array.")), // exhaustive-deps
    (0x3C576391, One("Expected literal to be on the {{expectedSide}} side of {{operator}}.")), // yoda expected
    (0x3C80759E, One("Remove or uncomment this test.")), // no-commented-out-tests
    (0x3CD49CEB, One("Declare this member as a constructor parameter property and remove the class field plus assignment.")), // parameter-properties preferParameterProperty
    (0x3D523E1C, One("remove the comma or insert `undefined`")), // no-sparse-arrays unexpectedSparseArray
    (0x3D84DFFA, One("Using the return value is a legacy feature.")), // no-render-return-value
    (0x3D891842, One("Try removing the prop `{{attr_name}}`.")), // aria-unsupported-elements
    (0x3DFD522C, One("Replace `new Response(JSON.stringify(...))` with `Response.json(...)`")), // prefer-response-static-json
    (0x3E23022F, One("Define an explicit argument type for each argument.")), // explicit-module-boundary-types missingArgType
    (0x3F702622, One("Avoid explicit `any` at module boundaries; prefer `unknown` and narrow before use.")), // explicit-module-boundary-types anyTypedArgUnnamed
    (0x3FD5EFB3, One("Avoid explicit `any` at module boundaries; prefer `unknown` and narrow before use.")), // explicit-module-boundary-types anyTypedArg
    (0x4037A6A1, One("use `export ... from ...;`")), // prefer-export-from
    (0x403D7235, One("Use Unicode code point escapes (e.g., \\u{1F1EF} for the regional indicator symbol for 'J') instead of regional indicator symbol pairs in character classes.")), // no-misleading-character-class regionalIndicatorSymbol
    (0x40451C31, One("Consider refactoring the code to eliminate the need for labels.")), // no-labels unexpectedLabel
    (0x406EC540, of_the_fix(false, First, "")), // prefer-optional-catch-binding
    (0x40C9F62F, One("{{help}}")), // no-restricted-properties restrictedProperty
    (0x40CE6680, One("Define an explicit return type for the function.")), // explicit-module-boundary-types missingReturnType
    (0x412B54E4, One("Prefer a default export")), // prefer-default-export
    (0x4144820D, One("Remove the Boolean call as it will already be coerced to a boolean")), // no-extra-boolean-cast unexpectedCall
    (0x414AD720, Three(&["", "", "Using spreads within accumulators leads to `O(n^2)` time complexity."])), // no-accumulating-spread loopSpread
    (0x41AC451D, One("The promise must end with a call to .catch, or end with a call to .then with a rejection handler, or be explicitly marked as ignored with the `void` operator.")), // no-floating-promises floatingVoid
    (0x41D3B241, One("Consider revising the pattern to remove or relocate the backreference so it points to a group that can be matched at the time of evaluation.")), // no-useless-backreference forward
    (0x41FB84E2, One("Move this component to a separate file.")), // no-multi-comp
    (0x42361FBE, One("Consider revising the pattern to remove or relocate the backreference so it points to a group that can be matched at the time of evaluation.")), // no-useless-backreference intoNegativeLookaround
    (0x427DA840, One("Convert this to a top-level type qualifier to properly remove the entire import.")), // no-import-type-side-effects useTopLevelQualifier
    (0x427F318F, One("Consider omitting the unnecessary end argument.")), // no-unnecessary-slice-end
    (0x42A5A57F, One("Rename the file with a good extension.")), // jsx-filename-extension
    (0x4330D24B, One("Define a getter for this property")), // accessor-pairs missingGetterInType
    (0x434A3BA3, One("Define a setter for this property")), // accessor-pairs missingSetterInType
    (0x43773440, One("Consider using a different variable to avoid unintended side effects on the parameter.")), // no-param-reassign assignmentToFunctionParam
    (0x442E57AD, One("Replace this `void` type with an allowed type, or keep `void` only in a valid return position.")), // no-invalid-void-type invalidVoidNotReturn
    (0x44DE9770, One("Variable '{{name}}' is used outside its declaration block. Declare it outside the block or use 'let'/'const'.")), // block-scoped-var outOfScope
    (0x44E6FF10, Three(&["", "this parameter only appears in one overload", ""])), // unified-signatures omittingRestParameter
    (0x450297EB, One("Use a different variable name or remove the duplicate declaration.")), // no-redeclare redeclared
    (0x4576BB38, One("Replace inline type specifiers with a top‐level import type statement.")), // consistent-type-specifier-style
    (0x45E80181, One("Add `tabIndex={0}` to make the element reachable via sequential keyboard navigation.")), // interactive-supports-focus
    (0x467B6DF5, Three(&["Remove the duplicated case", "This label here", ""])), // no-duplicate-case unexpected
    (0x46896AB1, Three(&["", "", "Using spreads within accumulators leads to `O(n^2)` time complexity."])), // no-accumulating-spread reduceSpread
    (0x4694688D, One("This method name is confusing, consider renaming the method to `constructor`")), // no-misused-new errorMessageClass
    (0x46BABB14, One("Use a quantifier: ` {{{length}}}`")), // no-regex-spaces multipleSpaces
    (0x47001535, One("Replace it with `Number.{{method_name}}`")), // prefer-number-properties
    (0x470199BD, One("Return the value being passed into Promise.resolve instead")), // no-return-wrap
    (0x470CFC81, One("Replace with `toBeCalledTimes(1)` or `toHaveBeenCalledTimes(1)` for clarity and consistency")), // prefer-called-times
    (0x471B73CB, One("Mark it as `readonly`.")), // prefer-readonly preferReadonly
    (0x47AD07A4, Three(&["If you did not intend to divide, insert ';' before the slash", "this is parsed as division, which may be unintentional", ""])), // no-unexpected-multiline division
    (0x4905AD5B, of_the_fix(false, All, "")), // consistent-type-definitions typeOverInterface
    (0x492CC0DB, One("Remove the `export *` re-export, or add named exports to the target module.")), // export
    (0x4937801E, One("The first argument of 'Number.prototype.{{method_name}}' should be a number between {{min}} and {{max}}")), // number-arg-out-of-range
    (0x49BD2FA0, One("Did you forget to call the function?")), // no-misused-spread noFunctionSpreadInObject
    (0x49E9C313, One("If an object is defined as 'thenable', once it's accidentally used in an await expression, it may cause problems")), // no-thenable
    (0x49EA0B99, One("Use the variable's original name or rename it to a different name")), // no-useless-rename unnecessarilyRenamed
    (0x4ADFEF5E, One("Add function argument")), // no-disabled-tests
    (0x4AE7B876, One("To create parameterized test with `{{fn_kind}}` function you should use `.{{method}}`")), // consistent-each-for
    (0x4B164347, One("Remove this redundant `return` statement.")), // no-useless-return unnecessaryReturn
    (0x4BA3B55F, One("Do not use import syntax to configure webpack loaders")), // no-webpack-loader-syntax
    (0x4BD8F9C6, One("Destructure useState call into value + setter pair follow the [thing, setThing] naming convention")), // hook-use-state
    (0x4BF1674B, Three(&["Add the global flag (g) to the regular expression.", "", "`matchAll` throws a `TypeError` when passed a non-global regular expression."])), // bad-match-all-arg
    (0x4C73543E, One("Wrap it in an IIFE for a local variable, or assign it as a global property for a global variable.")), // no-implicit-globals globalNonLexicalBinding
    (0x4C8838ED, One("You should use `as const` instead of type annotation.")), // prefer-as-const preferConstAssertion
    (0x4CAC9F7A, One("Remove the debugger statement")), // no-debugger unexpected
    (0x4CC7D5D8, One("Prefer `.flatMap(…)` over `.map(…).flat()`.")), // prefer-array-flat-map
    (0x4CD9641B, One("Using `new` ensures the error is correctly initialized.")), // throw-new-error
    (0x4CFCA4DC, One("Put a value of `undefined` immediately after the `=>`.")), // arrow-body-style unexpectedEmptyBlock
    (0x4CFFC774, of_the_fix(false, First, "")), // no-deprecated-functions
    (0x4D020C34, One("Add an `expect` or assertion call as the last statement in the test block.")), // prefer-ending-with-an-expect
    (0x4D9BF559, Three(&["", "", "Named default exports improve grepability and enable consistent auto-imports across the codebase."])), // no-anonymous-default-export
    (0x4DA2D1D3, One("Use `toHaveBeenCalledTimes()` to assert the number of times a mock function was called")), // prefer-to-have-been-called-times
    (0x4DCA515A, One("Remove the unnecessary \"{{constraint}}\" constraint")), // no-unnecessary-type-constraint unnecessaryConstraint
    (0x4DF5D5D7, One("Reduce nesting with promises or refactoring your code.")), // max-nested-callbacks exceed
    (0x4E109504, Three(&["Add the 'u' flag.", "", "The 'u' and 'v' flags enable Unicode-aware regular expression behavior and stricter pattern parsing."])), // require-unicode-regexp requireUFlag
    (0x4E226EF4, of_the_fix(false, First, "")), // escape-case
    (0x4E99BC4E, One("Remove `aria-hidden=\"true\"` from focusable elements or modify the element to be not focusable.")), // no-aria-hidden-on-focusable
    (0x4E9DB508, Three(&["Wrap the async handler and forward errors to `next()` (e.g. `(req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)`).\nExpress does not automatically handle rejected promises from async handlers, which results in unhandled promise rejections and server crashes.", "", "If you're on Express 5, disable this rule. To allow specific functions, add their names to `allowedNames`."])), // no-async-endpoint-handlers
    (0x4EF6DB9D, One("Reduce the number of classes in this file")), // max-classes-per-file maximumExceeded
    (0x501D6803, One("Add `await` to your assertion.")), // valid-expect
    (0x50755686, One("Use `unknown` instead, this will force you to explicitly, and safely, assert the type is correct.")), // no-explicit-any unexpectedAny
    (0x50F2970D, One("Replace with a safe alternative like https://cdnjs.cloudflare.com/polyfill/ or use modern browser features directly. See: https://blog.cloudflare.com/polyfill-io-now-available-on-cdnjs-reduce-your-supply-chain-risk")), // no-unwanted-polyfillio
    (0x50FFD073, One("See https://nextjs.org/docs/messages/no-sync-scripts")), // no-sync-scripts
    (0x51203CCD, One("Rename the function or the variable/property so the names satisfy this rule.")), // func-name-matching notMatchProperty
    (0x516ED453, One("`isMounted` is not supported in modern React, and does not work in class or function components.")), // no-is-mounted
    (0x51D00F97, One("Add `@class` tag or use class syntax.")), // implements-on-classes
    (0x51D024C7, One("Remove the try/catch wrapper, since it does not provide any additional error handling or functionality.")), // no-useless-catch unnecessaryCatch
    (0x521DF4D2, One("Return the callback call or add an explicit return immediately after it.")), // callback-return
    (0x52347A5F, One("Enforce the consistent use of either `function` declarations or expressions assigned to variables")), // func-style expression
    (0x52821B9E, Three(&["Use `await` for async assertions or remove the return statement.", "", "Jest ignores returned values from tests."])), // no-test-return-statement
    (0x52A4DF84, One("This is most likely not the intended outcome. Consider removing the operation, or directly assigning zero to the variable")), // erasing-op
    (0x52AF321E, One("Use the `isNaN` function instead of the switch.")), // use-isnan caseNaN
    (0x52B28245, of_the_fix(false, First, "")), // curly unexpectedCurlyAfter
    (0x52BC8235, One("Write an actual test and remove the `.todo` modifier before pushing/merging your changes.")), // warn-todo
    (0x53091EDD, One("This logical expression can be simplified. Try using the `{{operator}}` operator instead.")), // double-comparisons
    (0x531E3EC8, One("Consider revising the pattern to remove or relocate the backreference so it points to a group that can be matched at the time of evaluation.")), // no-useless-backreference disjunctive
    (0x5354B870, One("Replace var with let or const")), // no-var unexpectedVar
    (0x5368BAFF, One("Add {type} to `@yields` tag.")), // require-yields-type
    (0x5398EA92, One("Preserve the original error by using the `cause` property when re-throwing errors.")), // preserve-caught-error caughtErrorShadowed
    (0x53A1C515, One("Switch to `structuredClone(…)`.")), // prefer-structured-clone
    (0x53D9403E, One("Add a comment explaining the depth.")), // no-magic-array-flat-depth
    (0x53FB4E46, One("Consider handling the promises' fulfillment or rejection with Promise.all or similar.")), // no-floating-promises floatingPromiseArray
    (0x548F0D63, One("Use named export instead.")), // no-restricted-exports restrictedDefault
    (0x54B14656, One("Move the type annotation to the constructor")), // consistent-generic-constructors preferConstructor
    (0x54CBEA1A, One("Remove empty braces")), // require-module-specifiers
    (0x5557B33E, Three(&["", "", "Named default exports improve grepability and enable consistent auto-imports across the codebase."])), // no-anonymous-default-export
    (0x556EEF87, One("Did you forget to pass a callback to the hook?")), // exhaustive-deps
    (0x559A3AAA, One("This `if` has no `else` branch, so the callback may reach the end without a `return`. Add an `else`, or add a final `return`/`throw` after the `if`.{{value_requirement}}")), // array-callback-return mayReachEndOfIf
    (0x5646286A, One("Replace the character with its normalized form (NFC) or use Unicode code point escapes instead of combining sequences.")), // no-misleading-character-class combiningClass
    (0x568E64EB, Three(&["To replace all occurrences of a string, use the `replaceAll` method with the global flag (g) in the regular expression.", "", "Unlike `replace`, `replaceAll` throws a `TypeError` when passed a non-global regular expression instead of replacing only the first match."])), // bad-replace-all-arg
    (0x56D50D2B, One("Remove the import statement for this macro.")), // no-import-compiler-macros
    (0x56D7811F, One("Move it to its own statement instead.")), // no-confusing-void-expression invalidVoidExpr
    (0x56E93E46, One("Replace this `void` type with an allowed type, or keep `void` only in a valid return position.")), // no-invalid-void-type invalidVoidNotReturnOrGeneric
    (0x5782557A, One("Add a `ref` parameter, or remove `forwardRef`")), // forward-ref-uses-ref
    (0x58A466ED, One("Add a `default` case.")), // default-case missingDefaultCase
    (0x58DA34B4, One("Media elements such as `<audio>` and `<video>` must have a `<track>` for captions.")), // media-has-caption
    (0x590E840B, of_the_fix(false, First, "")), // prefer-spy-on
    (0x593BD524, One("Using this.xxx instead of this.refs.xxx")), // no-string-refs
    (0x59B22FBB, One("Use a custom UI instead")), // no-alert unexpected
    (0x59F21520, One("Prefer `{{without_suffix}}Once()`.")), // prefer-called-once
    (0x5A2BB6EF, One("Remove the catch clause, since it does not provide any additional error handling or functionality beyond what the finalizer already provides.")), // no-useless-catch unnecessaryCatchClause
    (0x5A2D5611, One("Replace this `void` type with an allowed type, or keep `void` only in a valid return position.")), // no-invalid-void-type invalidVoidForGeneric
    (0x5A60BB58, of_the_fix(false, First, "")), // no-useless-collection-argument
    (0x5A80AFB1, One("The radix parameter should be an integer between 2 and 36, or a variable that is not `undefined`.")), // radix invalidRadix
    (0x5A9E7553, One("Add the Unicode flag 'u'.")), // no-misleading-character-class surrogatePairWithoutUFlag
    (0x5AF1595D, One("Enforce the consistent use of either `function` declarations or expressions assigned to variables")), // func-style declaration
    (0x5B734369, One("Check if you meant to write `import { {{export}} } from {{suggested_module_name}}`")), // no-named-as-default-member
    (0x5BC28272, One("All code paths inside a render function must return a value.")), // require-render-return
    (0x5BEE2655, One("Add the entry to the Map initializer array.")), // no-immediate-mutation
    (0x5C900B00, One("Use ES module imports or `import = require` instead.")), // no-var-requires noVarReqs
    (0x5CC6FCF8, One("Remove the negation operator and use '{{suggested_operator}}' instead of '{{current_operator}}'.")), // no-negation-in-equality-check
    (0x5D0F92E9, One("Use a named constant instead of a magic number to make the code more readable and maintainable.")), // no-magic-numbers noMagic
    (0x5D441852, One("Remove string interpolation from snapshots")), // no-interpolation-in-snapshots
    (0x5D7B2CB9, One("Maximum allowed is {{max}}.")), // max-lines exceed
    (0x5DB5EA2F, One("Export the component object directly instead of assigning it to a variable first.")), // require-direct-export
    (0x5DB72799, One("Remove this empty export.")), // no-useless-empty-export uselessExport
    (0x5E3E5C10, One("Consider removing the spread operator.")), // no-useless-spread
    (0x5E7E7B07, One("Consider removing this method from your interface.")), // no-misused-new errorMessageInterface
    (0x5E7FBF0E, Three(&["Consider renaming '{{name}}' to avoid shadowing the variable from the outer scope.", "'{{name}}' is declared here", ""])), // no-shadow noShadow
    (0x5E808371, One("Must have meaningful value for `alt` prop. Use alt=\"\" for presentational images.")), // alt-text
    (0x5E9582B5, One("If you are testing for NaN, you can use the `Number.isNaN()` function.")), // no-self-compare comparingToSelf
    (0x5E98BF1B, One("Pass a single numeric argument to `{{prefix}}.assertions()`.")), // prefer-expect-assertions
    (0x5E9FBEEF, One("Updating state after a component update triggers a second render() call and can lead to property/layout thrashing.")), // no-did-update-set-state
    (0x5EC9566A, of_the_fix(false, First, "")), // valid-next-tick
    (0x5ED5EA27, One("Call `super()` before `this`/`super` property access.")), // no-this-before-super noBeforeSuper
    (0x5EF87FAD, One("Assigning a variable to this instead of properly using arrow lambdas may be a symptom of pre-ES2015 practices or not managing scope well.")), // no-this-alias thisAssignment
    (0x5EFB52AD, One("Avoid executing source text at runtime.")), // no-implied-eval execScript
    (0x5F1AAC0D, Three(&["Avoid the `Function` constructor. Define the function directly with a function declaration/expression or an arrow function.", "Dynamic function construction is used here.", "The `Function` constructor compiles code from strings at runtime, which can introduce injection risks, hurts performance, and makes code harder to analyze and maintain."])), // no-new-func noFunctionConstructor
    (0x5F289D03, One("inline the variable or import it from another module.")), // valid-define-props
    (0x5FC22DE6, One("Either `await` the promise, `return` it, or use `expect().resolves`/`expect().rejects`.")), // valid-expect-in-promise
    (0x60274EAA, One("Use `exports` instead.")), // exports-style
    (0x6050AC87, of_the_fix(false, All, "")), // array-type errorStringArray
    (0x6064B3C1, One("Remove the async wrapper and pass the promise directly to expect")), // no-unneeded-async-expect-function
    (0x60775FC2, One("remove the argument for better type inference.")), // valid-define-emits
    (0x608038F2, One("Add root description to `@param`.")), // require-param-description
    (0x6099C903, Three(&["Move all \"{{name}}\" overload signatures together, placing them consecutively before any other members.", "", "Function overload signatures represent multiple ways a function can be called. Keeping them adjacent makes it easier for developers to understand all available call signatures at a glance."])), // adjacent-overload-signatures adjacentSignature
    (0x6131F82C, One("Add description comment to `@throws` tag.")), // require-throws-description
    (0x6182F6AE, One("A descriptive message makes the error easier to debug when it is caught or logged.")), // error-message
    (0x619CF5B6, One("Use Unicode code point escapes (e.g., \\u{1F3FB} for the light skin tone modifier) instead of emoji modifier sequences in character classes.")), // no-misleading-character-class emojiModifier
    (0x61C4E6B8, One("Remove `.toArray()`.")), // no-useless-iterator-to-array
    (0x61D610DB, One("Provide a non-empty string that describes what went wrong.")), // error-message
    (0x62896888, One("This `switch` has no `default` case, so the callback may reach the end without a `return`. Add a `default` that returns/throws, or add a final `return` after the `switch`.{{value_requirement}}")), // array-callback-return mayFallThroughSwitch
    (0x62F126DF, One("Wrap the case body in braces `{}` to create an explicit block scope for the lexical declaration.")), // no-case-declarations unexpected
    (0x62FB98DC, Three(&["If you did not intend to make a function call, insert ';' before the parenthesis", "this is parsed as a function call, which may be unintentional", ""])), // no-unexpected-multiline function
    (0x63289AA6, One("Add missing aria props {{props}} to the element with `{{role}}` role.")), // role-has-required-aria-props
    (0x639C39AB, One("Try memoizing this variable with `useRef` or `useCallback`.")), // exhaustive-deps
    (0x643A3C40, One("Move require() to top-level module scope")), // global-require
    (0x645CBB4B, One("Use arrow functions or lexical scoping instead of passing 'thisArg' as a second argument to array methods like map, filter, etc.")), // no-array-method-this-argument
    (0x6490DABD, One("Move it before the `return` statement.")), // no-confusing-void-expression invalidVoidExprReturn
    (0x649BA4B6, One("Move the generic type to the type annotation")), // consistent-generic-constructors preferTypeAnnotation
    (0x65D9A51E, One("`Reflect.apply()` is less verbose and easier to understand.")), // prefer-reflect-apply
    (0x65E653F3, One("Remove all but one spread.")), // jsx-props-no-spread-multi
    (0x65F96EAF, One("{{message}}")), // no-restricted-matchers
    (0x6634C5A7, One("Provide an explicit type parameter or an initial value.")), // require-typed-ref
    (0x66A86706, One("Move the returned value to be immediately after the `=>`.")), // arrow-body-style unexpectedSingleBlock
    (0x67B8A380, One("Replace `findDOMNode` with one of the alternatives documented at https://react.dev/reference/react-dom/findDOMNode#alternatives.")), // no-find-dom-node
    (0x67CED70F, One("This rule enforces a maximum number of parameters allowed in function definitions.")), // max-params exceed
    (0x67D5835A, One("Use an object literal instead of `Object.assign`. eg: `{ foo: bar }`.")), // prefer-object-spread useLiteralMessage
    (0x680FDFE8, One("Rename the function or the variable/property so the names satisfy this rule.")), // func-name-matching notMatchVariable
    (0x686191F3, of_the_fix(false, First, "")), // function-component-definition
    (0x686EEEB2, One("See https://nextjs.org/docs/messages/no-css-tags")), // no-css-tags
    (0x68A1A5BB, One("Consider removing it from the dependency array. Outer scope values aren't valid dependencies because mutating them doesn't re-render the component.")), // exhaustive-deps
    (0x68B710EF, One("Wrapping the return value in `Promise.resolve` is needlessly verbose. All return values in async functions are already wrapped in a `Promise`.")), // no-useless-promise-resolve-reject
    (0x692FE0A5, One("{{customMessage}}")), // no-restricted-imports pathWithCustomMessage
    (0x697C0C1E, One("Either include it or remove the dependency array.")), // exhaustive-deps
    (0x69ABD53A, One("Replace this string literal with a non-literal expression, such as a call to a translation function.")), // jsx-no-literals
    (0x69CCD28C, One("`watch` and `watchEffect` should be called synchronously in `setup()`. Move the call before the first `await`.")), // no-watch-after-await
    (0x6A29E837, of_the_fix(false, First, "")), // prefer-math-trunc
    (0x6A610A9A, One("Add name to `@param` tag.")), // require-param-name
    (0x6B9BE531, of_the_fix(false, First, "")), // prefer-prototype-methods
    (0x6B9CF3B0, One("Move this hoisted API to the top of the file to better reflect its behavior.\nYou may alternatively replace `vi.mock()` with `vi.doMock`, which is not hoisted.")), // hoisted-apis-on-top
    (0x6BCE2B27, Three(&["Add the 'v' flag.", "", "The 'u' and 'v' flags enable Unicode-aware regular expression behavior and stricter pattern parsing."])), // require-unicode-regexp requireVFlag
    (0x6BE5A143, One("Write a meaningful title for your test")), // valid-title
    (0x6C4F7631, One("Delete this console statement.")), // no-console unexpected
    (0x6C63014F, One("Execute the code directly instead.")), // no-script-url unexpectedScriptURL
    (0x6CAC0AD0, Three(&["Remove the redundant non-null assertion operator (`!`).", "", "The non-null assertion operator in TypeScript, written as `!`, tells the compiler that an expression is definitely not `null` or `undefined` at that point. Chaining multiple non-null assertions on the same expression does not provide any additional safety and is redundant."])), // no-extra-non-null-assertion noExtraNonNullAssertion
    (0x6D013E47, One("Remove the negation operator and switch the consequent and alternate branches.")), // no-negated-condition
    (0x6D67D4DA, One("Use `toStrictEqual()` instead")), // prefer-strict-equal
    (0x6D94AF0C, One("Consider using a different variable to avoid unintended side effects on the parameter's properties.")), // no-param-reassign assignmentToFunctionParamProp
    (0x6DA49EAF, One("The `Function` type accepts any function-like value")), // ban-types
    (0x6DE8A23F, of_the_fix(false, First, "")), // no-empty-named-blocks
    (0x6E4044E9, One("Use props and context directly as function parameters instead of accessing them through `this`")), // no-this-in-sfc
    (0x6E5C6A36, of_the_fix(false, First, "")), // function-component-definition
    (0x6E682581, One("Add a type parameter to the mock function, e.g. `vi.{{method_name}}<() => void>()`.")), // require-mock-type-parameters
    (0x6E72D2C7, One("Preserve the original error by using the `cause` property when re-throwing errors.")), // preserve-caught-error missingCause
    (0x6EB15CD7, of_the_fix(false, First, "")), // no-null
    (0x6ECB24E9, One("Remove the `required: true` option, or drop the `required` key entirely to make this prop optional.")), // no-required-prop-with-default
    (0x6F0AB04C, One("{{customMessage}}")), // no-restricted-imports everythingWithAllowedImportNamePatternWithCustomMessage
    (0x6F1DD394, of_the_fix(false, First, "")), // object-shorthand expectedMethodShorthand
    (0x6FF55E58, One("Remove the default assignment")), // no-useless-default-assignment uselessUndefined
    (0x70393C91, One("The `throw` keyword seems to be missing in front of this 'new' expression")), // missing-throw
    (0x7043F91E, One("Consider refactoring the code to eliminate the need for labels.")), // no-labels unexpectedLabelInContinue
    (0x70558DB2, One("Use an index signature such as `{ [key: string]: unknown }` instead of a record type.")), // consistent-indexed-object-style preferIndexSignature
    (0x70962A56, One("Change to `Date.now()`.")), // prefer-date-now
    (0x709A8728, One("Add {type} to `@param` tag.")), // require-param-type
    (0x70BF82FC, One("Move {{type}} declaration to {{body}} root")), // no-inner-declarations moveDeclToRoot
    (0x710AF355, of_the_fix(false, First, "")), // ban-tslint-comment commentDetected
    (0x718431E5, One("Replace `import()` type annotations with a regular type import. For example, change `type T = import('module').Type` to `import type { Type } from 'module'; type T = Type`.")), // consistent-type-imports noImportTypeAnnotations
    (0x71BF1211, One("Possible to fix it please see: https://nextjs.org/docs/messages/no-styled-jsx-in-document#possible-ways-to-fix-it")), // no-styled-jsx-in-document
    (0x71C9BA62, Three(&["If in-place mutation is acceptable, use `push` (or `concat` when semantics match) instead of spreading", "", "`push` mutates the array. `concat` returns a new array and is not equivalent for every iterable."])), // no-map-spread
    (0x71DC9E56, One("Do not modify `exports` itself.")), // exports-style
    (0x71E0D9DB, One("Either include it or remove the dependency array.")), // exhaustive-deps
    (0x72888656, One("Replace top‐level import type with an inline type specifier.")), // consistent-type-specifier-style
    (0x7289F291, One("Remove the `!`, or wrap the left-hand side in parentheses.")), // no-confusing-non-null-assertion confusingAssign
    (0x7316FAB1, One("Move the handler to an interactive element, or use an appropriate interactive role.")), // no-noninteractive-element-interactions
    (0x7350C08B, One("Remove return statement in your describe callback")), // valid-describe-callback
    (0x7370F353, of_the_fix(false, First, "")), // consistent-type-assertions as
    (0x73ADA4DE, of_the_fix(false, First, "")), // function-component-definition
    (0x73BD2A09, One("Use the `isNaN` function to compare with NaN.")), // use-isnan comparisonWithNaN
    (0x73DAE700, One("Use lowercase for the number literal prefix `0x` and uppercase for hexadecimal digits.")), // number-literal-case
    (0x73E689A2, One("Require grouped accessor pairs in object literals and classes")), // grouped-accessor-pairs invalidOrder
    (0x73FB5C91, One("The nullish coalescing operator is designed to handle undefined and null - using a non-null assertion is not needed.")), // no-non-null-asserted-nullish-coalescing noNonNullAssertedNullishCoalescing
    (0x74052CCF, One("Add an explicit delay argument.")), // explicit-timer-delay
    (0x7438222A, One("Remove the declaration or use it in the code.")), // no-unused-private-class-members unusedPrivateClassMember
    (0x74772748, One("Too many nested describe calls ({{current}}) - maximum allowed is {{max}}")), // max-nested-describe
    (0x7485E6BA, One("Remove Braces for case clause.")), // switch-case-braces
    (0x754980E5, One("This should be done within a hook")), // require-hook
    (0x758E4948, One("This comparison will always return {{const_result}} as object literals are never equal to each other. Consider using `Object.entries()` of `Object.keys()` and comparing their lengths.")), // bad-object-literal-comparison
    (0x7616A2A5, One("{{customMessage}}")), // no-restricted-imports everythingWithCustomMessage
    (0x764B4A7A, One("Use \"@ts-expect-error\" to ensure an error is actually being suppressed.")), // prefer-ts-expect-error preferExpectErrorComment
    (0x767C35BB, One("Add a file extension to this {{import_or_export}}.")), // extensions
    (0x76C7C203, One("Remove the `scope` prop on elements other than `<th>`.")), // scope
    (0x76FFA74C, One("Remove the `async` keyword")), // no-async-await
    (0x771243CE, One("Add `await` before the function call.")), // prefer-top-level-await
    (0x776978BB, One("Use an array literal as the second argument.")), // exhaustive-deps
    (0x77997183, One("Collect all promises into an array and use `Promise.all()` to run them in parallel, rather than awaiting each one sequentially inside the loop.")), // no-await-in-loop unexpectedAwait
    (0x77CDA732, One("Rewrite the IIFE to avoid having a parenthesized arrow function body.")), // no-unreadable-iife
    (0x77F7FD45, One("Change the `tabIndex` prop to a non-positive value.")), // tabindex-no-positive
    (0x78474DB3, One("Use the `isNaN` function to check for NaN values.")), // use-isnan indexOfNaN
    (0x784C8E87, One("Remove the return statement from the constructor. If you need early exit, use a bare `return;` with no value.")), // no-constructor-return unexpected
    (0x78ED9184, One("Using external library instead, for example mitt.")), // no-deprecated-events-api
    (0x78F396CE, One("The function type form `{{suggestion}}` is generally preferred when possible for being more succinct.")), // prefer-function-type unexpectedThisOnFunctionOnlyInterface
    (0x797AD421, Three(&["Remove the non-null assertion.", "non-null assertion made after optional chain", ""])), // no-non-null-asserted-optional-chain noNonNullOptionalChain
    (0x798BFAED, One("Change the first letter of the comment to uppercase")), // capitalized-comments unexpectedLowercaseComment
    (0x79D87FD1, One("Use `await` with `try`/`catch` instead of promise chaining for more readable and maintainable async code.")), // prefer-await-to-then
    (0x7A5C1437, One("`RegExp#test()` exclusively returns a boolean and therefore is more efficient.")), // prefer-regexp-test
    (0x7A83C681, Three(&["Replace the array literal type assertion with a type annotation. For example, change `const x = [1, 2] as Type[]` to `const x: Type[] = [1, 2]`. Alternatively, use `const x = [1, 2] satisfies Type[]` if you want TypeScript to infer the exact array type.", "", "Type assertions on array literals can hide errors where the array doesn't actually match the asserted type. Using type annotations or `satisfies` ensures TypeScript verifies that the array matches the expected type."])), // consistent-type-assertions unexpectedArrayTypeAssertion
    (0x7B1FB820, One("Missing the separator argument.")), // require-array-join-separator
    (0x7B6BF287, of_the_fix(false, All, "")), // consistent-type-definitions interfaceOverType
    (0x7B8E21D0, One("Use of triple-slash reference type directives is generally discouraged in favor of ECMAScript Module imports.")), // triple-slash-reference tripleSlashReference
    (0x7BA56C1B, One("You can try to fix this by turning on the `noImplicitThis` compiler option, or adding a `this` parameter to the function.")), // no-unsafe-member-access unsafeThisMemberExpression
    (0x7BA57611, One("Multiline strings are not allowed. Use template literals or string concatenation instead.")), // no-multi-str multilineString
    (0x7BE6F2F9, One("Remove the `return` statement.")), // no-confusing-void-expression invalidVoidExprReturnLast
    (0x7CBAD694, of_the_fix(false, First, "")), // no-test-prefixes
    (0x7CC8D36D, One("The ref value will likely have changed by the time this effect cleanup function runs. If this ref points to a node rendered by react, copy it to a variable inside the effect and use that variable in the cleanup function.")), // exhaustive-deps
    (0x7D500530, One("Remove this element's children or use a non-void element.")), // void-dom-elements-no-children
    (0x7D8088CC, One("Prefer using `{{fn_name}}.each` rather than a manual loop.")), // prefer-each
    (0x7D83D2BA, One("Prefer using `\"{{preferred_method}}\"` instead")), // prefer-comparison-matcher
    (0x7D9F2601, One("The promise must end with a call to .catch, or end with a call to .then with a rejection handler.")), // no-floating-promises floating
    (0x7DA5DD05, One("Replace this getter with a readonly field initialized to the returned literal.")), // class-literal-property-style preferFieldStyle
    (0x7DA8315F, One("WAI-ARIA roles should not be used to convert an interactive element to a non-interactive element. Wrap the element or use a different structure.")), // no-interactive-element-to-noninteractive-role
    (0x7DEA67FA, Three(&["", "", "The non-null assertion operator (`!`) removes `null` and `undefined` from the type. For example, it changes `number | undefined` to `number`."])), // no-non-null-assertion noNonNull
    (0x7DF33290, of_the_fix(false, First, "")), // explicit-length-check
    (0x7E03A6C9, One("Try using standalone functions instead of static methods")), // no-extraneous-class onlyStatic
    (0x7E327F05, One("Prefer {{replacement}}(/* expected args */)")), // prefer-called-with
    (0x7E38A935, One("This logical expression will always evaluate to the same value as the expression itself.")), // const-comparisons
    (0x7E3DED4F, One("Provide `title` property for `iframe` element.")), // iframe-has-title
    (0x7E5C6924, One("Does {{imported_name}} have the default export?")), // default
    (0x7EF65762, One("Remove `export default`.")), // valid-define-props
    (0x7F15A285, One("Pass a function callback instead of source text.")), // no-implied-eval impliedEval
    (0x7F38C6CD, of_the_fix(false, First, "")), // jsx-boolean-value
    (0x7F86BC56, of_the_fix(false, First, "")), // catch-error-name
    (0x7F943CCB, One("Default values are re-created on every render and break referential equality, causing unnecessary re-renders. Move the value out of the component or memoize it.")), // no-object-type-as-default-prop
    (0x801EF696, One("\"{{arrayMethodName}}\" ignores the callback's return value. Remove the returned value (use `return;` or no `return`), or use `map`/`flatMap` if you meant to produce a new array.")), // array-callback-return expectedNoReturnValue
    (0x80AC457B, One("This type means \"any non-nullish value\", which is slightly better than 'unknown', but it's still a broad type")), // ban-types
    (0x810DC9D9, One("simplify props or memoize props in the parent component (https://react.dev/reference/react/memo#my-component-rerenders-when-a-prop-is-an-object-or-array).")), // jsx-no-new-object-as-prop
    (0x81181E35, One("Extract the expression to a separate variable so it can be statically checked.")), // exhaustive-deps
    (0x81ECF042, of_the_fix(false, First, "")), // no-unused-labels unused
    (0x81F75B05, One("Wrap the function in an arrow function to explicitly pass only the element argument")), // no-array-callback-reference
    (0x822664B6, One("Consider moving this to the top of the functions scope or using let or const to declare this variable.")), // vars-on-top top
    (0x823B2F2D, One("Add assertion(s) in this Test")), // expect-expect
    (0x823B4E38, One("Wrap the `value` prop in useMemo() or useCallback(), or use a constant value to prevent unnecessary re-renders.\nAlternatively, move the value outside the render function if it doesn't depend on props or state.")), // jsx-no-constructed-context-values
    (0x824F9C6D, One("There should be only one instance of access tag in a JSDoc comment.")), // check-access
    (0x82801981, One("`{{title}}`s should begin with lowercase")), // prefer-lowercase-title
    (0x82B929F0, One("Combine multiple assignments into a single `module.exports = { ... }` statement")), // group-exports
    (0x8303A4C7, One("Either use the value directly, or switch to `Promise.resolve(…)`.")), // no-single-promise-in-promise-methods
    (0x831BBAE5, One("Use a browser-compatible alternative or add this module to the `allow` list if Node.js usage is intentional.")), // no-nodejs-modules
    (0x83439EE7, One("simplify props or memoize props in the parent component (https://react.dev/reference/react/memo#my-component-rerenders-when-a-prop-is-an-object-or-array).")), // jsx-no-new-function-as-prop
    (0x83451D02, One("Change the `type` attribute to one of the allowed values: {{allowed_types}}.")), // button-has-type
    (0x835861AA, One("Add parameters for parsing numbers, e.g., `parseInt('10', 10)`.")), // radix missingParameters
    (0x8360E1E4, One("Use 'module.exports' instead.")), // no-exports-assign
    (0x838A42D5, of_the_fix(false, First, "")), // prefer-string-replace-all
    (0x83E2D9AC, of_the_fix(false, First, "")), // prefer-string-replace-all
    (0x841A2F88, One("Add an explicit 'public', 'private', or 'protected' modifier. Members without a modifier are implicitly public, which may not be intentional.")), // explicit-member-accessibility missingAccessibility
    (0x84551859, One("Remove either `checked` or `defaultChecked`.")), // checked-requires-onchange-or-readonly
    (0x8471437D, One("Pass an object with a `testTimeout` property to `vi.setConfig()`.")), // require-test-timeout
    (0x8484729E, One("Add parentheses around the nested ternary expression.")), // no-nested-ternary
    (0x84AB82D0, One("Provide a string literal as the hint, or pass a property matcher object as the first argument and the hint string as the second.")), // prefer-snapshot-hint
    (0x84BCD86A, of_the_fix(false, First, "")), // sort-imports sortMembersAlphabetically
    (0x84CC3F4B, One("This call will throw a TypeError at runtime.")), // no-obj-calls unexpectedCall
    (0x853D3736, One("See https://nextjs.org/docs/messages/google-font-display")), // google-font-display
    (0x856525FC, of_the_fix(false, First, "")), // curly missingCurlyAfterCondition
    (0x85AF642F, Three(&["Use `let` instead of `const` if you need to reassign this variable.", "{{name}} is declared here as `const`.", ""])), // no-const-assign const
    (0x863835C0, One("Add a description to this `@property` tag.")), // require-property-description
    (0x872D13BE, One("Use `()` to negate the whole expression, as '!' binds more closely than '{{operator}}'")), // no-unsafe-negation unexpected
    (0x87322D5F, One("Supported methods are: {{allowed}}.")), // no-console limited
    (0x8768308E, One("Calling `setState()` afterwards will replace the mutations you made via `this.state`.")), // no-direct-mutation-state
    (0x8771A3F9, One("combine all `defineProps` calls into a single `defineProps` call.")), // valid-define-props
    (0x87889300, One("Add a numeric third argument, a `{ timeout }` option object second argument, or call `vi.setConfig({ testTimeout: ... })` before this test.")), // require-test-timeout
    (0x87A24908, One("Must have meaningful value for `lang` prop.")), // html-has-lang
    (0x87C0B7B7, One("Replace the argument with a literal string or immutable template literal")), // no-dynamic-require
    (0x87C6AE3E, Three(&["Replace `parentNode.removeChild(childNode)` with `childNode.remove()`.", "", "https://developer.mozilla.org/en-US/docs/Web/API/Element/remove"])), // prefer-dom-node-remove
    (0x87E2FF31, Three(&["", "", "Named default exports improve grepability and enable consistent auto-imports across the codebase."])), // no-anonymous-default-export
    (0x880E8CF7, One("Remove the unnecessary block statement. If you need to limit variable scope, consider using a function or module instead.")), // no-lone-blocks redundantBlock
    (0x882EDA31, One("Add braces to the arrow function.")), // no-confusing-void-expression invalidVoidExprArrow
    (0x88327F58, One("`Promise.{{static_name}}` is not a constructor. Call it as a function instead.")), // no-new-statics
    (0x88746CF5, One("Specify the rules you want to disable.")), // no-abusive-eslint-disable
    (0x8874C6B0, One("Use a static property access (e.g. `namespace.name`) instead of a computed one.")), // namespace
    (0x88C9C57E, One("Replace inline type specifiers with a top‐level import type statement.")), // consistent-type-specifier-style
    (0x89246B3B, One("Remove the `else` block, moving its contents outside of the `if` statement.")), // no-else-return unexpected
    (0x8963104E, One("Make sure the title matches the `mustMatch` of your config file")), // valid-title
    (0x898463D4, One("Use the assignment operator `{{sign}}=` instead.")), // no-plusplus unexpectedUnaryOp
    (0x899EA758, One("`caller`, `callee`, and `arguments` properties may not be accessed on strict mode functions or the arguments objects for calls to them.")), // no-caller unexpected
    (0x8A213DEC, One("Remove the unused import attribute.")), // require-module-attributes
    (0x8A89DF45, One("Remove this ternary operator and use the variable directly")), // no-unneeded-ternary unnecessaryConditionalAssignment
    (0x8A9605FE, Three(&["Use a number literal representable by a 64-bit floating-point number, or use a `BigInt` literal (for example, `9007199254740993n`) for exact large integers.", "", "In JavaScript, `Number` values exactly represent integers only in the range -9007199254740991 to 9007199254740991 (`Number.MIN_SAFE_INTEGER` to `Number.MAX_SAFE_INTEGER`). `BigInt` supports arbitrarily large integers."])), // no-loss-of-precision noLossOfPrecision
    (0x8ABD121A, One("Either include it or remove the dependency array.")), // exhaustive-deps
    (0x8AD4C18A, One("Use local Test Context instead")), // require-local-test-context-for-concurrent-snapshots
    (0x8AE6F07F, One("Add Braces for case clause.")), // switch-case-braces
    (0x8B6CA6B8, of_the_fix(false, First, "https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage")), // require-post-message-target-origin
    (0x8B9EEF6D, of_the_fix(true, First, "")), // jsx-no-useless-fragment
    (0x8BA1D2F1, One("Lifecycle hooks should be called synchronously in `setup()`. Move the hook call before the first `await`.")), // no-lifecycle-after-await
    (0x8BA4818B, One("This logical expression will always evaluate to the same value as either side.")), // const-comparisons
    (0x8C9A3028, of_the_fix(false, First, "")), // consistent-empty-array-spread
    (0x8D1408A7, Three(&["Consider renaming '{{name}}' to avoid shadowing the variable from the outer scope.", "'{{name}}' is declared here", "Enum members are added to the enum scope, so references to '{{name}}' in enum member initializers resolve to this member instead of the declaration in the upper scope."])), // no-shadow noEnumShadow
    (0x8D4EEAAF, One("Try replacing this class with a standalone function or deleting it entirely")), // no-extraneous-class onlyConstructor
    (0x8D628DE3, One("Remove this empty block or add content to it.")), // no-empty-static-block unexpected
    (0x8D7C59AE, One("Consider wrapping the assignment in additional parentheses")), // no-cond-assign unexpected
    (0x8D88D57B, One("Consider converting method{{name}} to a static method.")), // class-methods-use-this missingThis
    (0x8DA73E29, Three(&["Substitute the assertion with `{{code}}`.", "", "https://vitest.dev/api/expect#tobetypeof"])), // prefer-expect-type-of
    (0x8EC92FCB, One("Variable declared without assignment. Either assign a value or remove the declaration.")), // no-unassigned-vars unassigned
    (0x9021BBE3, One("To avoid confusion around the {} type allowing any non-nullish value, this rule bans usage of the {} type.")), // no-empty-object-type noEmptyObject
    (0x90BD2E9A, Three(&["Capitalize the first letter of the constructor name, or add it to the exceptions list if it should not be capitalized.", "This should be uppercase", ""])), // new-cap lower
    (0x90C03318, One("Use a named capture group like \"(?<name>...)\" — this regex has {{unnamed_count}} unnamed group{{s}}.")), // prefer-named-capture-group required
    (0x914A5EF2, One("Use `then` and `catch` directly")), // no-callback-in-promise
    (0x9199CAC4, One("Remove the fallthrough comment or add code that allows fallthrough (e.g. remove `break`).")), // no-fallthrough unusedFallthroughComment
    (0x921522BD, One("Define at least one prop in `defineProps`.")), // valid-define-props
    (0x92842C3D, One("{{customMessage}}")), // no-restricted-imports everythingWithAllowImportNamesAndCustomMessage
    (0x9285F5BC, One("You need to call your matcher, e.g. `expect(true).toBe(true)`.")), // valid-expect
    (0x92899C84, One("Use a local variable or function parameter instead of the restricted global.")), // no-restricted-globals customMessage
    (0x92AF00FF, Three(&["", "", "Named default exports improve grepability and enable consistent auto-imports across the codebase."])), // no-anonymous-default-export
    (0x92DE5142, One("Use a `button` element instead of an `a` element.")), // anchor-is-valid
    (0x930BC3EC, One("Consider removing this case or removing the `default` case.")), // no-useless-switch-case
    (0x930CE0BB, One("Remove the `accessKey` attribute. Inconsistencies between keyboard shortcuts and keyboard commands used by screen readers and keyboard-only users create accessibility complications.")), // no-access-key
    (0x936D88A9, One("Only the last call to `jest.setTimeout` will have an effect.")), // no-confusing-set-timeout
    (0x93E80588, Three(&["Add a description after @ts-{{directive}} that is at least {{minimumDescriptionLength}} characters long, explaining why the directive is necessary. For example: `// @ts-{{directive}}: TS2345 - This is a known limitation with third-party types`", "", "Requiring descriptions ensures that developers document why they're suppressing TypeScript errors, making it easier for future maintainers to understand the context and decide if the suppression is still necessary."])), // ban-ts-comment tsDirectiveCommentRequiresDescription
    (0x93FAA91F, One("Remove `.toArray()`.")), // no-useless-iterator-to-array
    (0x93FFFE35, Three(&["If in-place mutation is acceptable, use `Object.assign` or direct property assignment instead of spreading", "", "`Object.assign` mutates the first argument. Disable this rule if copy-on-write behavior is required."])), // no-map-spread
    (0x94116C9A, of_the_fix(false, First, "`{{typeName}}` is a boxed object type, not a primitive. Boxed types have object semantics (identity/truthiness) that can be surprising. Use `{{preferred}}` for values, and in `extends`/`implements` use an interface/object shape instead.")), // no-wrapper-object-types bannedClassType
    (0x9477C5C2, One("Valid access levels are `package`, `private`, `protected`, and `public`.")), // check-access
    (0x94EDCB08, One("Control flow inside `try` or `catch` blocks will be overwritten by this statement.")), // no-unsafe-finally unsafeUsage
    (0x95283D32, One("Do not use the `continue` statement.")), // no-continue unexpected
    (0x95474AF7, of_the_fix(false, First, "")), // prefer-string-starts-ends-with
    (0x9573D46D, One("See: https://nextjs.org/docs/messages/google-font-preconnect")), // google-font-preconnect
    (0x95E7A825, One("Use a non-negative numeric literal for the timeout value.")), // require-test-timeout
    (0x95FED5F5, One("The Error constructor already calls `captureStackTrace` internally, so calling it again is unnecessary.")), // no-useless-error-capture-stack-trace
    (0x96A87BDE, One("Use `<React.Fragment></React.Fragment>` instead of `<></>`.")), // jsx-fragments
    (0x97730A48, One("Use 'const' instead of 'let' or 'var' to declare number constants to make their immutability explicit.")), // no-magic-numbers useConst
    (0x97CD5B21, One("Replace the property signature with method shorthand syntax.")), // method-signature-style errorProperty
    (0x98214428, One("Only pass an Error object to the reject() function for user-defined errors in Promises.")), // prefer-promise-reject-errors rejectAnError
    (0x984ACAFA, of_the_fix(false, First, "")), // explicit-length-check
    (0x9860D0C0, One("Replace `Node#appendChild()` with `Node#append()`.")), // prefer-dom-node-append
    (0x98B1D184, One("Replace the class field declaration with the value from `this` assignment.")), // prefer-class-fields
    (0x98C42E09, One("If this short-circuits with 'undefined' the evaluation will throw TypeError")), // no-unsafe-optional-chaining unsafeOptionalChain
    (0x98F58515, One("Consider giving this function expression a name.")), // func-names unnamed
    (0x98F68BCF, of_the_fix(false, First, "")), // prefer-math-min-max
    (0x99B68D6E, One("Use `undefined` instead")), // no-void noVoid
    (0x99EBCD74, One("Use `find(predicate)` instead of `filter(predicate)[0]` or similar patterns.")), // prefer-array-find
    (0x9A28EDC3, One("Try to remove the irregular whitespace")), // no-irregular-whitespace noIrregularWhitespace
    (0x9A5B5A31, of_the_fix(false, First, "")), // component-definition-name-casing
    (0x9ABD1E60, One("The listener argument should be a function reference.")), // no-invalid-remove-event-listener
    (0x9AF51DCD, One("Delete this file or add some code to it.")), // no-empty-file
    (0x9B264F04, One("Visible, non-interactive elements with click handlers must have one of `keyup`, `keydown`, or `keypress` listener.")), // click-events-have-key-events
    (0x9B4D6B59, One("Import from `vitest` instead.")), // no-import-node-test
    (0x9B7C4335, One("Extract intermediate results into named variables to reduce nesting.")), // max-nested-calls
    (0x9C1E1379, One("Replace this `void` type with an allowed type, or keep `void` only in a valid return position.")), // no-invalid-void-type invalidVoidUnionConstituent
    (0x9C4495C1, One("Either give the label a `htmlFor` attribute with the id of the associated control, or wrap the label around the control.")), // label-has-associated-control
    (0x9CAFDEED, One("Add at least one import or export statement to unambiguously mark this file as a module")), // unambiguous
    (0x9CE88A4B, One("Call `.flat()` on the array instead.")), // prefer-array-flat
    (0x9CEA1942, One("Add an error message to \"{{matcher_name}}\"")), // require-to-throw-message
    (0x9D0C9DCE, One("Remove the `await`")), // no-await-in-promise-methods
    (0x9DA05EA0, One("This attribute is listed in `restrictedAttributes`; replace its string literal value with a non-literal expression.")), // jsx-no-literals
    (0x9DC29154, One("Consider refactoring your code.")), // max-depth tooDeeply
    (0x9E01697E, of_the_fix(false, First, "")), // jsx-boolean-value
    (0x9E236B61, One("Change the title of test.")), // no-identical-title
    (0x9EC2FE79, One("Remove argument(s) of describe callback")), // valid-describe-callback
    (0x9FE1D3CE, One("Remove `.toArray()`.")), // no-useless-iterator-to-array
    (0xA01AC578, One("Declare static values as class fields instead of assigning them to `this` in the constructor.")), // prefer-class-fields
    (0xA032BEA0, Three(&["Merge the duplicated import into a single import statement", "This import is duplicated", ""])), // no-duplicate-imports import
    (0xA04674AC, of_the_fix(false, First, "")), // prefer-dom-node-dataset
    (0xA087B343, One("Use `<Link />` from `next/link` instead for internal navigation. See https://nextjs.org/docs/messages/no-html-link-for-pages")), // no-html-link-for-pages
    (0xA09B127D, One("Remove the @ts-{{directive}} directive and fix the underlying TypeScript error instead. If you must suppress an error, consider using @ts-expect-error with a descriptive comment explaining why it's necessary.")), // ban-ts-comment tsDirectiveComment
    (0xA0B67ACB, One("Define at least one event in `defineEmits`.")), // valid-define-emits
    (0xA0D015A0, One("Remove focus from test.")), // no-focused-tests
    (0xA0E2E977, of_the_fix(true, First, "")), // jsx-curly-brace-presence
    (0xA0E3B9A9, One("It is included in the `disallowedWords` of your config file, try to remove it from your title")), // valid-title
    (0xA11E2B4B, One("if `{{lhs_str}}` evaluates to true, `{{rhs_str}}` will always evaluate to true as well")), // const-comparisons
    (0xA1395355, One("`Array#sort()` mutates the original array. Use `Array#toSorted()` to return a new sorted array without modifying the original.")), // no-array-sort
    (0xA13F3933, One("Remove the extra arguments.")), // valid-expect
    (0xA14925FC, One("Check this link for the valid values of `sandbox` attribute: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe#sandbox.")), // iframe-missing-sandbox
    (0xA1656366, One("Replace the reassignment with a default parameter.")), // prefer-default-parameters
    (0xA1AA64D9, One("Handle the nullish case explicitly.")), // strict-boolean-expressions conditionErrorNullableObject
    (0xA1EBE911, One("Compute the value before returning it, or wrap the assignment in parentheses to make the intent explicit.")), // no-return-assign arrowAssignment
    (0xA21E96A6, One("Make sure the title does not match the `mustNotMatch` of your config file")), // valid-title
    (0xA237E215, One("Remove redundant `@yields` tag.")), // require-yields
    (0xA239492E, Three(&["Use a local variable instead of modifying the global '{{name}}'.", "Read-only global '{{name}}' should not be modified.", ""])), // no-global-assign globalShouldNotBeModified
    (0xA24F6A04, One("{{customMessage}}")), // no-restricted-imports patternAndEverythingWithCustomMessage
    (0xA299A7EB, of_the_fix(false, First, "")), // prefer-prototype-methods
    (0xA2BB9DDF, Three(&["", "", "Named default exports improve grepability and enable consistent auto-imports across the codebase."])), // no-anonymous-default-export
    (0xA35BBFF4, One("Use object literal notation {} instead")), // no-object-constructor preferLiteral
    (0xA36125B5, One("Replace the method signature with a property whose type is a function type.")), // method-signature-style errorMethod
    (0xA37216DA, One("Separate each assignment into its own statement")), // no-multi-assign unexpectedChain
    (0xA39911F7, One("Pass an iterable of Promise-like values, or wrap each synchronous value in `Promise.resolve(...)` before calling the aggregator.")), // await-thenable invalidPromiseAggregatorInput
    (0xA3CD3DCF, One("If your function does not access `this`, you can annotate it with `this: void`, or consider using an arrow function instead.")), // unbound-method unboundWithoutThisAnnotation
    (0xA3FE0095, One("Use a single export declaration with multiple specifiers: `export { spec1, spec2 }`")), // group-exports
    (0xA45423F7, One("Remove `async` keyword")), // valid-describe-callback
    (0xA482BD6C, One("Reduce the number of dependencies in this file")), // max-dependencies
    (0xA4A4D8EB, Three(&["Merge the duplicated exports into a single export statement", "This export is duplicated", ""])), // no-duplicate-imports exportAs
    (0xA4C84134, One("Replace `.filter(…).flatMap(…)` with a single `.flatMap(…)`.")), // prefer-array-flat-map
    (0xA4E55B7F, One("Consider removing the `async` keyword.")), // require-await missingAwait
    (0xA4EBAE34, One("Separate `require()` from `new` operator")), // no-new-require
    (0xA4FEC9F7, One("Avoid nesting ternary expressions for more than one level.")), // no-nested-ternary
    (0xA550E5CF, One("Replace this call with `{{replacement}}`.")), // prefer-number-coercion
    (0xA5713C0F, One("Use an arrow function instead.")), // prefer-arrow-callback preferArrowCallback
    (0xA59D59AF, One("Remove the unreachable code or fix the control flow to make it reachable.")), // no-unreachable unreachableCode
    (0xA5DF2034, One("Forbid named default exports.")), // no-named-default
    (0xA63FC691, One("Does {{module_name}} have the export {{imported_name}}?")), // named
    (0xA65E38C7, One("remove the argument for better type inference.")), // valid-define-props
    (0xA680EB4A, of_the_fix(false, First, "")), // prefer-importing-jest-globals
    (0xA6848C64, One("Add a type parameter to the mock factory such as `typeof import({{module_name}})`")), // no-untyped-mock-factory
    (0xA6A3075C, One("Remove the explicit `0` delay argument.")), // explicit-timer-delay
    (0xA6C73740, One("Handle the error or rename the parameter if it's not an error.")), // handle-callback-err
    (0xA6DEB743, One("Add {type} to the `@returns` tag.")), // require-returns-type
    (0xA6DF883A, Three(&["Use `.length - 1` to replace the last element.", "", "An array's `.length` is one past its last valid index."])), // no-confusing-array-with
    (0xA740D924, One("Each child in a list should have a unique 'key' prop")), // jsx-key
    (0xA7D7E9CA, One("These two values can never be equal")), // no-constant-binary-expression alwaysNew
    (0xA7EE021C, One("Prefer using `{{function}}` instead of `{{opposite}}`.")), // consistent-vitest-vi
    (0xA81B952C, One("Pass only one argument to the slot function.")), // no-multiple-slot-args
    (0xA83C3DF8, One("Too many assertion calls ({{count}}) - maximum allowed is {{max}}")), // max-expects
    (0xA86EE8DB, One("Remove the constructor or add code to it.")), // no-useless-constructor noUselessConstructor
    (0xA872474E, One("inline the variable or import it from another module.")), // valid-define-emits
    (0xA88D6F0B, One("Move `{{name}}` to the outer scope to avoid recreating it on every call.")), // consistent-function-scoping
    (0xA8D87DAF, One("Replace named exports with a single export default to ensure a consistent module entry point.")), // no-named-export
    (0xA94E0D11, of_the_fix(false, First, "")), // prefer-string-raw
    (0xA95AEAAE, One("Disabling destructuring of this is not a default, consider allowing destructuring")), // no-this-alias thisDestructure
    (0xA97AE8D9, One("The function type form `{{suggestion}}` is generally preferred when possible for being more succinct.")), // prefer-function-type functionTypeOverCallableType
    (0xA9FE8F0B, One("Add `{{prefix}}.hasAssertions()` or `{{prefix}}.assertions(<number>)` as the first statement in the test.")), // prefer-expect-assertions
    (0xAA0E7FA2, One("Add a text label to the control element. This can be done by adding text content, an `aria-label` attribute, or an `aria-labelledby` attribute.")), // control-has-associated-label
    (0xAA1D712D, One("to avoid prototype pollution, use `Object.prototype.{{prop}}.call` instead")), // no-prototype-builtins prototypeBuildIn
    (0xAA3BF80C, One("Remove the file extension from this {{import_or_export}}.")), // extensions
    (0xAABFCF80, One("Throw an error instead.")), // no-process-exit
    (0xAAC75309, Three(&["`React.cloneElement` is uncommon and leads to fragile React components.", "", "https://react.dev/reference/react/cloneElement#alternatives"])), // no-clone-element
    (0xAAC8A001, One("Require explicit return types on functions and class methods.")), // explicit-function-return-type missingReturnType
    (0xAB22E794, One("Use named or default imports")), // no-namespace
    (0xAB539868, One("Replace HTML elements with `role` attribute `{{role}}` to corresponding semantic HTML tag `{{tag}}`.")), // prefer-tag-over-role
    (0xAB8EDC17, One("Make the component self closing")), // self-closing-comp
    (0xAB94B666, One("Add a `super()` call to the constructor")), // constructor-super missingAll
    (0xABA004B6, One("Hooks should come before test cases")), // prefer-hooks-on-top
    (0xAC654D44, One("Remove the unnecessary assignment")), // no-unnecessary-parameter-property-assignment unnecessaryAssign
    (0xAC9E9DCA, One("Add a {type} to this `@property` tag.")), // require-property-type
    (0xACC35EBF, of_the_fix(false, First, "")), // no-test-prefixes
    (0xAD4FC5F0, One("Use named export instead.")), // no-restricted-exports restrictedDefault
    (0xADA5BAA4, One("Use Object.is(x, -0) to test equality with -0 and use 0 for other cases")), // no-compare-neg-zero unexpected
    (0xADB36002, of_the_fix(false, First, "")), // object-shorthand expectedLiteralMethodLongform
    (0xADEA61F1, One("Define a setter for this property")), // accessor-pairs missingSetterInClass
    (0xAE5D281B, Three(&["Consider removing the duplicated key", "Key is first defined here", ""])), // no-dupe-keys unexpected
    (0xAE60BBEC, One("Prefer passing `Date` directly to the constructor when cloning")), // consistent-date-clone
    (0xAE6C3BCE, One("Add a `sandbox` attribute to the `iframe` element.")), // iframe-missing-sandbox
    (0xAECB2492, One("Use lowercase for `e` in exponential notations.")), // number-literal-case
    (0xAEDB1D74, One("Remove the type annotation")), // no-inferrable-types noInferrableType
    (0xAF7C8CF2, One("Define a setter for this property")), // accessor-pairs missingSetterInObjectLiteral
    (0xAF9C23C1, One("Remove this ternary operator")), // no-unneeded-ternary unnecessaryConditionalExpression
    (0xAFEE01B5, One("Use named export instead.")), // no-restricted-exports restrictedDefault
    (0xAFEFB54A, One("{{customMessage}}")), // no-restricted-imports patternWithCustomMessage
    (0xB01C9482, One("Consider assigning the import to a variable or removing it if it's unused.")), // no-unassigned-import
    (0xB053E134, One("You can try to fix this by turning on the `noImplicitThis` compiler option, or adding a `this` parameter to the function.")), // no-unsafe-return unsafeReturnThis
    (0xB0BF39D1, One("Pass the function as a description title argument or modify the description title to not match any imported function name.")), // prefer-describe-function-title
    (0xB0C09E23, One("Add a role attribute to this element, or use a semantic HTML element instead.")), // no-static-element-interactions
    (0xB0CC8CAD, One("Replace the number literal with `{{lit}}`")), // no-zero-fractions
    (0xB0D16A25, One("Inline the setup or teardown logic directly in each test for better readability and isolation.")), // no-hooks
    (0xB107B85E, One("The `tabIndex` attribute should be removed.")), // no-noninteractive-tabindex
    (0xB12E5352, One("Change the first letter of the comment to lowercase")), // capitalized-comments unexpectedUppercaseComment
    (0xB19ED905, One("Replace \"{{name}}\" with its canonical name of \"{{canonical_name}}\"")), // no-alias-methods
    (0xB1A814F2, of_the_fix(false, All, "")), // array-type errorStringGenericSimple
    (0xB2443EEA, One("Remove the `new` operator.")), // no-new-wrappers notAConstructor
    (0xB296BFEB, One("Add a `@returns` tag to the JSDoc comment.")), // require-returns
    (0xB2C78415, One("The promise must end with a call to .catch, or end with a call to .then with a rejection handler. A rejection handler that is not a function will be ignored.")), // no-floating-promises floatingUselessRejectionHandler
    (0xB2D20D3D, One("Pass an inline function instead.")), // exhaustive-deps
    (0xB34DAB4C, One("Provide screen reader accessible content when using `a` elements.")), // anchor-has-content
    (0xB42720B5, One("Comparison result should not be used directly as an operand of another comparison. If you need to compare three or more operands, you should connect each comparison operation with logical AND operator (`&&`)")), // bad-comparison-sequence
    (0xB4484750, One("Use a local variable or function parameter instead of the restricted global.")), // no-restricted-globals defaultMessage
    (0xB4873FEE, One("This can result in NaN.")), // no-unsafe-optional-chaining unsafeArithmetic
    (0xB5917204, One("See https://nextjs.org/docs/messages/no-head-element")), // no-head-element
    (0xB5B04ECD, One("Did you forget to pass an array of dependencies?")), // exhaustive-deps
    (0xB5D340E7, One("Merge these imports into a single import statement")), // no-duplicates
    (0xB63C4486, One("See https://nextjs.org/docs/messages/no-assign-module-variable")), // no-assign-module-variable
    (0xB6495F3F, of_the_fix(false, First, "")), // prefer-numeric-literals useLiteral
    (0xB6FEBA1F, One("Use a unique data-dependent key to avoid unnecessary rerenders")), // no-array-index-key
    (0xB733DAF4, One("Remove the argument and its usage. Alternatively, use the argument in the function body.")), // only-used-in-recursion
    (0xB7864DFF, One("Remove the import statement for this macro.")), // no-import-compiler-macros
    (0xB7A2A3A3, One("See: 'https://nextjs.org/docs/messages/no-page-custom-font")), // no-page-custom-font
    (0xB7B1DBBD, One("Remove the arguments from `{{prefix}}.hasAssertions()`.")), // prefer-expect-assertions
    (0xB7E68201, One("Remove the `autoFocus` attribute.")), // no-autofocus
    (0xB888DD19, One("Remove `allow-scripts` or `allow-same-origin`.")), // iframe-missing-sandbox
    (0xB8C4F070, Three(&["Consider using `<Image />` from `next/image` or a custom image loader to automatically optimize images.", "", "See https://nextjs.org/docs/messages/no-img-element"])), // no-img-element
    (0xB908C6F3, One("Remove the dangling '_' or add `{{identifier}}` to the 'allow' configuration.")), // no-underscore-dangle unexpectedUnderscore
    (0xB94A4974, One("Use `Array.isArray(…)`, `typeof … === 'string'`, or another realm-safe alternative instead")), // no-instanceof-builtins
    (0xB9649756, One("Remove the negation operator and switch the consequent and alternate branches.")), // no-negated-condition unexpectedNegated
    (0xB9C0660B, One("Preserve the original error by using the `cause` property when re-throwing errors.")), // preserve-caught-error incorrectCause
    (0xB9DF2664, One("Remove the loop or make at least one path continue to the next iteration.")), // no-unreachable-loop invalid
    (0xBA35DD43, One("Merge with the previous call.")), // prefer-single-call
    (0xBAAFC30B, One("Use `await expect(...).resolves` instead")), // prefer-expect-resolves
    (0xBACA7360, One("Imported namespace members are read-only. Assign to a local variable instead.")), // namespace
    (0xBAEB47B1, One("Replace this expression with `import.meta.dirname`.")), // prefer-import-meta-properties
    (0xBAFB064B, One("This expression always evaluates to the constant on the left-hand side")), // no-constant-binary-expression constantShortCircuit
    (0xBB8E23B2, of_the_fix(false, First, "")), // no-typeof-undefined
    (0xBB941C45, Three(&["Replace `Object` with a more specific type. If you need a generic object, use `Record<string, unknown>` or define an interface/type with explicit properties. If you need any value, use `unknown` instead.", "", "The `Object` type is confusing because it doesn't mean 'any object' - it means 'any non-nullish value', which includes primitives. This makes code harder to understand and can lead to unexpected behavior."])), // ban-types
    (0xBBB60C82, One("Rewrite this `if`/`else` as a ternary expression.")), // prefer-ternary
    (0xBBDC9945, One("Set a valid value for `lang` attribute.")), // lang
    (0xBC20EDA4, One("Remove the leading or trailing spaces")), // valid-title
    (0xBC23A703, One("Throwing literals or non-Error objects is not recommended. Use an Error object instead.")), // no-throw-literal object
    (0xBC32FC4D, One("Follow the [thing, setThing] naming convention")), // hook-use-state
    (0xBC421B75, One("See https://nextjs.org/docs/messages/no-title-in-document-head")), // no-title-in-document-head
    (0xBC5457DD, One("Add a type name to this `@property` tag.")), // require-property-name
    (0xBCD177C5, One("Add {type} to `@throws` tag.")), // require-throws-type
    (0xBD73E97F, One("Use a more specific type to ensure type safety.")), // strict-boolean-expressions conditionErrorAny
    (0xBD8E1A3D, One("Use array literal notation [] instead.")), // no-array-constructor useLiteral
    (0xBDAA4491, One("Use `Object.fromEntries(pairs)` instead of manually building objects with `reduce` or `forEach`.")), // prefer-object-from-entries
    (0xBDFFAF10, One("Add name as first argument and callback as second argument")), // valid-describe-callback
    (0xBE055C31, One("Remove or rephrase this comment")), // no-warning-comments unexpectedComment
    (0xBE056113, of_the_fix(false, First, "")), // prefer-import-from-vue
    (0xBE2456FB, of_the_fix(false, First, "")), // operator-assignment replaced
    (0xBE70D594, One("Remove the `!`, or prefix the `=` with it.")), // no-confusing-non-null-assertion confusingEqual
    (0xBEAC061A, One("Instead use `jest.mock` or `vi.mock` and import from the original module path.")), // no-mocks-import
    (0xBEC89835, One("Use an object spread instead of `Object.assign` eg: `{ ...foo }`.")), // prefer-object-spread useSpreadMessage
    (0xBED5EED0, One("Prefer `jest.mocked()`")), // prefer-jest-mocked
    (0xBED66FB7, One("Did you forget to await the promise before spreading it?")), // no-misused-spread noPromiseSpreadInObject
    (0xBF2CCD40, One("{{what}} are not permitted on `@{{tag_name}}` tag.")), // no-defaults
    (0xBFCE433D, of_the_fix(false, First, "")), // prefer-array-some
    (0xBFDF8F0D, One("Update the description after @ts-{{directive}} to match the required pattern: {{format}}.")), // ban-ts-comment tsDirectiveCommentDescriptionNotMatchPattern
    (0xBFDF9F72, One("Ensure `super()` is called in all code paths")), // constructor-super missingSome
    (0xC032897D, One("Use `async`/`await` instead, or return an existing promise from a library function.")), // avoid-new
    (0xC0F0D78A, One("Did you mean to use a template string literal?")), // no-template-curly-in-string unexpectedTemplateExpression
    (0xC12E8574, One("Use '\\${' to escape '${' in template literals.")), // consistent-template-literal-escape
    (0xC145FD68, of_the_fix(false, First, "")), // curly unexpectedCurlyAfterCondition
    (0xC1BBA066, One("Use `Math.{{method_name}}` instead.")), // approx-constant
    (0xC1CA8D7D, One("Consider refactoring the component to reduce the number of props that are needed.")), // max-props
    (0xC1E275BC, One("Throwing literals or non-Error objects is not recommended. Use an Error object instead.")), // no-throw-literal undef
    (0xC2008EC6, One("Add `@param` tag with name.")), // require-param
    (0xC20FCE34, One("Add a \"key\" prop to the element in the iterator (https://react.dev/learn/rendering-lists#keeping-list-items-in-order-with-key).")), // jsx-key
    (0xC2AE9121, Three(&["Remove this constructor or add code to it.", "", "Subclasses automatically use the constructor of their superclass, making this redundant."])), // no-useless-constructor noUselessConstructor
    (0xC2D7E692, One("Move the Hook call before the condition, or call it unconditionally and branch inside the Hook/effect instead.")), // rules-of-hooks
    (0xC316E67B, Three(&["If you did not intend to access a property, insert ';' before the bracket", "this is parsed as a property access, which may be unintentional", ""])), // no-unexpected-multiline property
    (0xC370CDF0, One("Only use a single `<Head />` component in your custom document in `pages/_document.js`. See: https://nextjs.org/docs/messages/no-duplicate-head")), // no-duplicate-head
    (0xC3C08E65, Three(&["If you did not intend for this to be a tagged template, insert ';' before the backtick", "this is parsed as a tagged template, which may be unintentional", ""])), // no-unexpected-multiline taggedTemplate
    (0xC3F8879F, One("Use the callback's `vm` parameter instead of `this` in `beforeRouteEnter`.")), // no-this-in-before-route-enter
    (0xC434E826, of_the_fix(false, First, "")), // prefer-to-be-truthy
    (0xC482FC9B, One("Provide a correct `href` for the `a` element.")), // anchor-is-valid
    (0xC488C6EB, One("`Array#reverse()` mutates the original array. Use `Array#toReversed()` to return a new reversed array without modifying the original.")), // no-array-reverse
    (0xC4AF6C32, One("Prefer using one of the equality matchers instead")), // prefer-equality-matcher
    (0xC4DE872E, of_the_fix(false, First, "")), // curly missingCurlyAfter
    (0xC52F8ED0, One("Change `{{typo}}` to `{{suggestion}}`")), // no-typos
    (0xC5475EA0, One("Replace \"@ts-ignore\" with \"@ts-expect-error\".")), // ban-ts-comment tsIgnoreInsteadOfExpectError
    (0xC572B7B0, Three(&["Remove or modify the duplicate condition, as its branch will never be executed.", "condition first checked here", ""])), // no-dupe-else-if unexpected
    (0xC5D7A5F7, of_the_fix(false, First, "")), // object-shorthand expectedPropertyShorthand
    (0xC5DC7B37, One("Remove the return statement as nothing can consume the return value")), // no-return-in-finally
    (0xC5ECFCBE, One("use `Object.getPrototypeOf` and `Object.setPrototypeOf` instead.")), // no-proto unexpectedProto
    (0xC5F3BE7B, One("Require all enum members to be literal values.")), // prefer-literal-enum-member notLiteralOrBitwiseExpression
    (0xC6329069, One("{{help}}")), // no-restricted-properties restrictedObjectProperty
    (0xC63E95BF, One("Replace this `void` type with an allowed type, or keep `void` only in a valid return position.")), // no-invalid-void-type invalidVoidNotReturnOrThisParamOrGeneric
    (0xC647D82B, One("Remove the redundant role `{{role}}` from the element `{{element}}`.")), // no-redundant-roles
    (0xC685CA97, One("Use the `isNaN` function to compare with NaN.")), // use-isnan comparisonWithNaN
    (0xC73061CC, One("Add `{{prefix}}.hasAssertions()` or `{{prefix}}.assertions(<number>)` as the first statement in this test.")), // prefer-expect-assertions
    (0xC8028D27, One("Consider adding an empty list of dependencies to make it clear which values are intended to be stable.")), // exhaustive-deps
    (0xC86D58A2, Three(&["Move the declaration before any references to it, or remove the reference if it is not needed.", "used here", ""])), // no-use-before-define noUseBeforeDefine
    (0xC8913BD3, One("Add a `displayName` property to the context.")), // display-name
    (0xC8BAEEFF, One("You should use `as const` instead of type annotation.")), // prefer-as-const variableConstAssertion
    (0xC8F042E1, One("Switch to \"||\" or \"??\" operator")), // prefer-logical-operator-over-ternary
    (0xC91DE135, One("Handle the nullish and zero cases explicitly.")), // strict-boolean-expressions conditionErrorNullableNumber
    (0xC9719D8B, One("Wrap this text in a JSX expression container, such as a call to a translation function.")), // jsx-no-literals
    (0xC996806F, One("Using reference callback instead")), // no-string-refs
    (0xC9D5923E, One("Handle promise errors in a `catch` instead of using the second argument of `then`.")), // prefer-catch
    (0xCA374218, One("Add either `onChange` or `readOnly`.")), // checked-requires-onchange-or-readonly
    (0xCA492FE3, One("The spread operator (`...`) is more concise and readable.")), // prefer-spread
    (0xCA4A3180, One("Remove the redundant `@returns` tag.")), // require-returns
    (0xCA94982D, One("{{customMessage}}")), // no-restricted-imports patternAndEverythingWithRegexImportNameAndCustomMessage
    (0xCB04B359, One("Add `@yields` tag to the JSDoc comment.")), // require-yields
    (0xCB07DF7B, One("Require or disallow initialization in variable declarations")), // init-declarations initialized
    (0xCB71F493, One("Remove the return statement or ensure it does not return a value.")), // no-setter-return returnsValue
    (0xCB8E4930, One("Remove the `!`, or wrap the left-hand side in parentheses.")), // no-confusing-non-null-assertion confusingOperator
    (0xCBA8F125, Three(&["The `{{deprecated_prop}}` property is deprecated.", "", "https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key"])), // prefer-keyboard-event-key
    (0xCBA9E28F, of_the_fix(false, First, "")), // object-shorthand expectedMethodLongform
    (0xCBB7DD3F, One("Remove the empty character class: `[]`")), // no-empty-character-class unexpected
    (0xCBC1058B, One("Consider adding a `@property` tag or replacing it with a more specific type.")), // require-property
    (0xCC066ACD, One("Use named export instead.")), // no-restricted-exports restrictedDefault
    (0xCC4B2F1B, One("Use `{{replacement}}` instead. See https://legacy.reactjs.org/blog/2018/03/27/update-on-async-rendering.html")), // no-unsafe
    (0xCC71F6DB, One("Spreading falsy values in object literals won't add any unexpected properties, so it's unnecessary to add an empty object as fallback.")), // no-useless-fallback-in-spread
    (0xCCDD9B36, Three(&["Remove the assignment to the exception parameter, or refactor the code to use a different variable.", "this assignment destroys access to the caught exception", "If code in a catch block assigns a value to the exception parameter, it becomes impossible to refer to the error. Since there is no alternative way to access to this data, assignment of the parameter is absolutely destructive."])), // no-ex-assign unexpected
    (0xCD6621D3, One("Consider refactoring the code to eliminate the need for labels.")), // no-labels unexpectedLabelInBreak
    (0xCD7F4FBF, One("Use plain `using` for synchronous disposables, or change the value to implement `Symbol.asyncDispose`.")), // await-thenable awaitUsingOfNonAsyncDisposable
    (0xCDE5A417, One("If you want to share code between tests, move it into a separate file and import it from there.")), // no-export
    (0xCDF86BF9, One("Replace with a normal function invocation")), // no-useless-call unnecessaryCall
    (0xCEE2352D, One("Expected imports instead of AMD {{name}}()")), // no-amd
    (0xCF7B7BEF, One("If an object is defined as 'thenable', once it's accidentally used in an await expression, it may cause problems")), // no-thenable
    (0xCF8B528E, One("Use `classList.toggle()` instead")), // prefer-classlist-toggle
    (0xCFE5E9CF, One("Remove the second argument.")), // no-length-as-slice-end
    (0xD000C747, of_the_fix(false, First, "")), // prefer-to-be-falsy
    (0xD0426592, One("Bitwise operator '{{bad_operator}}' seems unintended. Did you mean logical operator '{{suggestion}}'?")), // bad-bitwise-operator
    (0xD047BF05, One("Remove `.toArray()`.")), // no-useless-iterator-to-array
    (0xD072A46A, One("Consider mapping the values to a meaningful string (e.g. pick a property or call a formatter) before calling `join()`, or implementing a custom `toString()`/`toLocaleString()` on the element type.")), // no-base-to-string baseArrayJoin
    (0xD105B19C, One("Both sides of the {{operator}} are literal values")), // no-constant-binary-expression constantRelationalComparison
    (0xD184DFD1, One("Remove braces in empty case clause.")), // switch-case-braces
    (0xD1AE8B99, One("Use `toHaveBeenCalled()` to check if function was called, or `not.toHaveBeenCalled()` to check if it wasn't called")), // prefer-to-have-been-called
    (0xD1CF7539, One("Try to add `onFocus`.")), // mouse-events-have-key-events
    (0xD1D097D1, One("Prefer alt=\"\" over presentational role. Native HTML attributes should be preferred for accessibility before resorting to ARIA attributes.")), // alt-text
    (0xD1E9140B, One("Consider removing the `await`")), // no-unnecessary-await
    (0xD20E792C, One("Dynamic import improves the type information and IntelliSense. Substitute `{{path}}` with `import('{{path}}')`")), // prefer-import-in-mock
    (0xD359EFA2, One("Use a record type such as `Record<string, unknown>` instead of an index signature.")), // consistent-indexed-object-style preferRecord
    (0xD39CB001, One("Remove the dependency from the dependency array.")), // exhaustive-deps
    (0xD3AA1A97, of_the_fix(false, First, "")), // prefer-object-has-own useHasOwn
    (0xD3CC24A7, One("Use Unicode code point escapes (e.g., \\u{1F468}\\u200D\\u{1F469} for '👨‍👩') instead of zero-width joiner sequences in character classes.")), // no-misleading-character-class zwj
    (0xD3E94999, One("See: https://nextjs.org/docs/messages/no-page-custom-font")), // no-page-custom-font
    (0xD3FDEBA0, One("simplify props or memoize props in the parent component (https://react.dev/reference/react/memo#my-component-rerenders-when-a-prop-is-an-object-or-array).")), // jsx-no-jsx-as-prop
    (0xD40EEE3E, One("The function name already has the prefix, try to remove the duplicate prefix")), // valid-title
    (0xD439F657, Three(&["", "", "Named default exports improve grepability and enable consistent auto-imports across the codebase."])), // no-anonymous-default-export
    (0xD49AB8F2, One("Move this export to the end of the file, after all other statements.")), // exports-last
    (0xD49EBEE9, Three(&["Remove the `super()` call or change the `extends` clause to a constructable superclass.", "This `super()` call is invalid here.", "`super()` calls the constructor of the superclass, but this class does not extend a constructable value."])), // constructor-super badSuper
    (0xD4AAB97B, One("Use uppercase for hexadecimal digits.")), // number-literal-case
    (0xD513A642, One("The `console.log()` method and similar methods join the parameters with a space so adding a leading/trailing space to a parameter, results in two spaces being added.")), // no-console-spaces
    (0xD5BEDB50, One("Consider using `toBeObject()` to test if a value is an object.")), // prefer-to-be-object
    (0xD6C0B474, One("Do not use the ternary expression.")), // no-ternary noTernaryOperator
    (0xD6C97C3E, of_the_fix(true, First, "")), // jsx-no-useless-fragment
    (0xD70F0A96, One("Remove the argument")), // no-unnecessary-array-flat-depth
    (0xD881F071, One("All code paths inside a computed getter must return a value.")), // return-in-computed-property
    (0xD885CC19, One("simplify props or memoize props in the parent component (https://react.dev/reference/react/memo#my-component-rerenders-when-a-prop-is-an-object-or-array).")), // jsx-no-new-array-as-prop
    (0xD899622F, One("Use named export instead.")), // no-restricted-exports restrictedDefault
    (0xD8B5E5F7, One("ES modules are always strict mode, so this directive is redundant.")), // prefer-module
    (0xD8F65EC5, One("Prefer `{{assert_identifier}}.ok(...)` over `{{assert_identifier}}(...)`.")), // consistent-assert
    (0xD8FE53AF, One("Sort variable declarations in ascending order (case-sensitive by default).")), // sort-vars sortVars
    (0xD90EF359, One("Remove this {{type}} or add a comment inside it")), // no-empty unexpected
    (0xD90F5410, One("It's better to use the same method to query DOM elements. This helps keep consistency and it lends itself to future improvements (e.g. more specific selectors).")), // prefer-query-selector
    (0xD9416D6B, One("Move the inner `if` test to the outer `if` test.")), // no-lonely-if
    (0xD950E53F, One("This compares constantly with the {{otherSide}}-hand side of the {{operator}}")), // no-constant-binary-expression constantBinaryOperand
    (0xD9B7948F, One("Replace length expression with negative index")), // prefer-negative-index
    (0xDA31B749, One("Change to `Date.now()`.")), // prefer-date-now
    (0xDA5D85E6, One("Use strict boolean comparison instead of truthy/falsy coercion.")), // prefer-strict-boolean-matchers
    (0xDAD8A3E8, One("Replace the namespace with an ES2015 module or use `declare module`")), // no-namespace moduleSyntaxIsPreferred
    (0xDB10F975, Three(&["Use the new operator when calling this function, or add it to the exceptions list if it should not be called with new.", "This should be called with `new`", ""])), // new-cap upper
    (0xDB48F444, One("Character access returns a string of length at most 1. If the return value is compared with a string of length greater than 1, the comparison will always be false.")), // bad-char-at-comparison
    (0xDB54409C, One("Provide no redundant alt text for image. Screen-readers already announce `img` tags as an image. You don't need to use the words `image`, `photo`, or `picture` (or any specified custom words) in the `alt` prop.")), // img-redundant-alt
    (0xDB81EC87, One("Consider picking a property (e.g. `user.name`), using a formatter (or `JSON.stringify`), or implementing a custom `toString()`/`toLocaleString()` on the type.")), // no-base-to-string baseToString
    (0xDBB6158F, One("Return a value from all code paths in getter.")), // getter-return expected
    (0xDC61091E, One("Add a `lang` attribute to the `html` element whose value represents the primary language of document.")), // html-has-lang
    (0xDC68306F, One("`dangerouslySetInnerHTML` is a way to inject HTML into your React component. This is dangerous because it can easily lead to XSS vulnerabilities.")), // no-danger
    (0xDC7EB91E, Three(&["Rename either the variable or the label to avoid confusion.", "Identifier '{{name}}' found here.", ""])), // no-label-var identifierClashWithLabel
    (0xDCC5E572, One("Remove the default assignment")), // no-useless-default-assignment uselessDefaultAssignment
    (0xDCEEC554, One("Is it a spelling mistake?")), // valid-expect
    (0xDDEE2678, of_the_fix(false, First, "")), // require-prop-type-constructor
    (0xDDF7FF7A, One("Consider wrapping the assignment in additional parentheses")), // no-cond-assign missing
    (0xDE3B446F, One("Consider using `else if` instead.")), // no-lonely-if unexpectedLonelyIf
    (0xDE487B04, One("Remove the double negation as it will already be coerced to a boolean")), // no-extra-boolean-cast unexpectedNegation
    (0xDE9B852F, One("Replace '{{kind}}' with 'const' to export an immutable binding.")), // no-mutable-exports
    (0xDF3909E4, One("Replace inline type specifiers with a top-level import type statement.")), // consistent-type-specifier-style
    (0xDF3EE5E7, One("Consider handling the promises' fulfillment or rejection with Promise.all or similar, or explicitly marking the expression as ignored with the `void` operator.")), // no-floating-promises floatingPromiseArrayVoid
    (0xDF9AB5F1, Three(&["Replace \"{{banned_type}}\" with the lowercase primitive type \"{{suggested_type}}\".", "", "{{banned_type}} is a wrapper object type, while {{suggested_type}} is the primitive type. Using the primitive type is more idiomatic and avoids confusion between the object wrapper and the primitive value."])), // ban-types
    (0xDFFFA08C, One("The promise must end with a call to .catch, or end with a call to .then with a rejection handler, or be explicitly marked as ignored with the `void` operator. A rejection handler that is not a function will be ignored.")), // no-floating-promises floatingUselessRejectionHandlerVoid
    (0xE03E56A7, One("Do not use CommonJS `require` calls")), // no-require-imports noRequireImports
    (0xE044E499, One("Remove this import. A module should not import itself.")), // no-self-import
    (0xE04FD184, One("Rename this export.")), // no-restricted-exports restrictedNamed
    (0xE09BFF21, Three(&["Wrap this value in curly braces", "Wrap this value in curly braces", ""])), // jsx-curly-brace-presence
    (0xE09D0B18, One("Use '{{suggested_operator}}' to compare with null")), // no-eq-null unexpected
    (0xE0D8226F, Three(&["Use the Cookie Store API or a cookie library instead.", "", "https://developer.mozilla.org/en-US/docs/Web/API/Cookie_Store_API"])), // no-document-cookie
    (0xE0E05D83, One("Remove `export default`.")), // valid-define-emits
    (0xE0EBE6D3, One("Consider using a more specific type to ensure safety.")), // no-unsafe-type-assertion unsafeToAnyTypeAssertion
    (0xE14757CE, Three(&["Move the `await` inside an `async` function, as ES modules with top-level `await` cannot be loaded with `require(esm)`.", "", "This rule is intended for published packages. Consider disabling it if this package is private."])), // no-top-level-await
    (0xE19777DE, One("Consider removing this {{fn_kind}} or adding logic to it.")), // no-empty-function unexpected
    (0xE199E5B5, One("Change to `Date.now()`.")), // prefer-date-now
    (0xE1DEC7FC, One("Handle the nullish and empty string cases explicitly.")), // strict-boolean-expressions conditionErrorNullableString
    (0xE206BD3B, One("Replace this expression with `import.meta.filename`.")), // prefer-import-meta-properties
    (0xE2277A53, One("Replace the absolute path with a relative path or a module alias.")), // no-absolute-path
    (0xE306EC1A, One("Consider using `Intl.Segmenter` for locale-aware string decomposition. Otherwise, if you don't need to preserve emojis or other non-ASCII characters, disable this lint rule on this line or configure the 'allow' rule option.")), // no-misused-spread noStringSpread
    (0xE47FB7DA, One("Variables declared with 'var' are function-scoped, not block-scoped. Consider using 'let' or 'const' for block-scoped variables, or move the function outside the loop.")), // no-loop-func unsafeRefs
    (0xE498E2B0, One("bitwise operators are not allowed, maybe you mistyped `&&` or `||`?")), // no-bitwise unexpected
    (0xE4D0D7C0, of_the_fix(false, First, "")), // no-hex-escape
    (0xE4EC54A3, Three(&["Update the condition to not be constant, or remove the condition entirely", "this expression will always evaluate to the same value", ""])), // no-constant-condition unexpected
    (0xE4FCAE99, One("Describe blocks can only have one of each hook. Consider consolidating the duplicate hooks into a single call.")), // no-duplicate-hooks
    (0xE50EA630, One("See https://nextjs.org/docs/messages/no-unwanted-polyfillio")), // no-unwanted-polyfillio
    (0xE565B460, One("`@{{tag_name}}` tag should not have body.")), // empty-tags
    (0xE5685438, One("Remove this label. It will have the same result because the labeled statement '{{name}}' has no nested loops or switches")), // no-extra-label unexpected
    (0xE568A058, One("Rename or remove the duplicate export so each name is exported only once.")), // export
    (0xE580006E, One("Include a hint string to identify this snapshot in the snapshot file.")), // prefer-snapshot-hint
    (0xE5EBCD1C, One("Handle the nullish case explicitly.")), // strict-boolean-expressions conditionErrorNullableBoolean
    (0xE706377D, One("Rewrite into one string literal.")), // no-useless-concat unexpectedConcat
    (0xE777912D, One("Replace string concatenation of `__dirname` or `__filename` with `path.join()` or `path.resolve()`.")), // no-path-concat
    (0xE7B34C56, of_the_fix(false, First, "")), // next-tick-style
    (0xE8B30721, One("Add description to `@param` tag.")), // require-param-description
    (0xE8EE39F8, One("{{customMessage}}")), // no-restricted-imports importNameWithCustomMessage
    (0xE92A065A, of_the_fix(false, First, "")), // prefer-todo
    (0xE971B765, One("Replace `.filter(…).length` with `.some(…)`")), // prefer-array-some
    (0xE97E09AF, One("Replace the `<{{element}}>` element with alternative, more accessible ways to achieve your desired visual effects.")), // no-distracting-elements
    (0xE99D5267, One("Compare against a member of the same enum as the switch value, or normalize both sides to the same primitive representation first.")), // no-unsafe-enum-comparison mismatchedCase
    (0xE9B56B33, One("Use Unicode code point escapes (e.g., \\u{1F44D}) instead of surrogate pairs.")), // no-misleading-character-class surrogatePair
    (0xE9C50A93, One("Remove `this` or convert to a non-exported function. In bundlers, `this` becomes `undefined` in exported functions.")), // no-this-in-exported-function
    (0xE9E29A8C, One("\"{{hook}}\" hooks should be before any \"{{previous_hook}}\" hooks")), // prefer-hooks-in-order
    (0xEA3192AA, One("Use `while` loop for intended infinite loop")), // for-direction incorrectDirection
    (0xEAB591FB, One("Prefer \"{{preferred_name}}\"")), // prefer-mock-promise-shorthand
    (0xEB77512C, One("\"{{arrayMethodName}}\" uses the callback's return value. Add a `return` on every possible code path.{{value_requirement}}")), // array-callback-return expectedInside
    (0xEBC3515F, One("Use `export type`.")), // consistent-type-exports typeOverValue
    (0xEBF16DC2, One("Add radix parameter `10` for parsing decimal numbers, or specify the appropriate radix for other number formats.")), // radix missingRadix
    (0xEC2D5854, One("Remove the interactive role or use an appropriate interactive element instead.")), // no-noninteractive-element-to-interactive-role
    (0xEC613EF3, One("`dangerouslySetInnerHTML` is not compatible with also passing children and React will throw a warning at runtime.")), // no-danger-with-children
    (0xEC763356, One("Avoid calling `expect` conditionally")), // no-conditional-expect
    (0xED78762F, One("Did you forget to add a matcher, e.g. `toBe`, `toBeDefined`")), // valid-expect
    (0xEDA48D4E, One("Handle the nullish and falsy enum cases explicitly.")), // strict-boolean-expressions conditionErrorNullableEnum
    (0xEDC9825F, One("Convert to an object instead of a class with only static members.")), // no-static-only-class
    (0xEE1F5A6E, Three(&["Replace the `import` declaration with `import type`. For example, change `import { Type } from 'module'` would become `import type { Type } from 'module'`.", "", "Using `import type` for type-only imports helps with tree-shaking, makes it clear that these imports don't affect runtime code, and can improve build performance by allowing bundlers to eliminate unused type imports."])), // consistent-type-imports typeOverValue
    (0xEE58986E, One("Use `Array.from({ length: n }, () => /* new value */)` or `.map(() => /* new value */)` to create a distinct value for each element.")), // no-array-fill-with-reference-type
    (0xEE6047E3, One("Move the properties from `Object.assign()` into the object initializer.")), // no-immediate-mutation
    (0xEF52F1E4, One("Prevent importing `next/document` outside of `pages/_document.js`.")), // no-document-import-in-page
    (0xEF897DAB, One("Move import statement to the top of the file")), // first
    (0xEFC0F404, One("{{customMessage}}")), // no-restricted-imports allowedImportNamePatternWithCustomMessage
    (0xEFE0EF94, One("Try adding the `type` keyword: `type {{exportNames}}`")), // consistent-type-exports singleExportIsType
    (0xEFEBFAA9, One("Delete this class")), // no-extraneous-class empty
    (0xF066073E, One("Replace the `import type` declaration with a regular `import` declaration. For example, `import type { Type } from 'module'` would become `import { Type } from 'module'`.")), // consistent-type-imports avoidImportType
    (0xF156010E, Three(&["Use a non-negative index to make the intended position explicit.", "", "`Array#with()` interprets a negative index as an offset from the end."])), // no-confusing-array-with
    (0xF1746AFD, One("Change the title of describe block.")), // no-identical-title
    (0xF1896FC1, One("Operands must each be a number or {{stringLike}}.")), // restrict-plus-operands invalid
    (0xF192F5C4, One("Updating state during the update step can lead to indeterminate component state and is not allowed.")), // no-will-update-set-state
    (0xF1A58E09, One("Move the comment to a separate line")), // no-inline-comments unexpectedInlineComment
    (0xF1EB9AE8, One("Remove pending() call")), // no-disabled-tests
    (0xF2BC9BE9, One("Add a `type` attribute to the `button` element.")), // button-has-type
    (0xF3BF69FE, Three(&["", "This export is duplicated", ""])), // no-duplicate-imports importAs
    (0xF43B393B, Three(&["Replace the alias with `globalThis`.", "", "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/globalThis"])), // prefer-global-this
    (0xF486CAA1, One("Remove all but one spread.")), // jsx-props-no-spread-multi
    (0xF4B54969, Three(&["Give {{second_name}} a unique value", "{{value}} is first used as an initializer here", ""])), // no-duplicate-enum-values duplicateValue
    (0xF4D295B7, One("Add `./` prefix")), // relative-url-style
    (0xF4DDFB84, One("These two values can never be equal")), // no-constant-binary-expression bothAlwaysNew
    (0xF53870F8, One("Add an error parameter to the catch clause to access the caught error.")), // preserve-caught-error missingCatchErrorParam
    (0xF5A9748D, One("Remove this interface and use the extended type directly or add members to this interface.")), // no-empty-interface noEmptyWithSuper
    (0xF61463C0, Three(&["", "this parameter only appears in one overload", ""])), // unified-signatures omittingSingleParameter
    (0xF6C8740D, One("Add a `tabindex` attribute to this {{el_name}}.")), // aria-activedescendant-has-tabindex
    (0xF6C8D03B, One("remove the comma or insert `undefined`")), // no-sparse-arrays unexpectedSparseArray
    (0xF82A7365, One("Remove `.toArray()`.")), // no-useless-iterator-to-array
    (0xF834DBE7, One("Consider using type guards or a safer assertion.")), // no-unsafe-type-assertion unsafeOfAnyTypeAssertion
    (0xF84112AB, One("The canonical way to pass children in React is to use JSX elements")), // no-children-prop
    (0xF894B5A4, One("Consider putting the asynchronous code inside a function and calling it from the effect.")), // exhaustive-deps
    (0xF95AFE11, One("See https://nextjs.org/docs/messages/no-script-component-in-head")), // no-script-component-in-head
    (0xF99C9D8A, One("Add the missing arguments.")), // valid-expect
    (0xF9B34A33, One("{{customMessage}}")), // no-restricted-imports allowedImportNameWithCustomMessage
    (0xFA73A165, One("Remove the `new` operator.")), // no-new-wrappers noConstructor
    (0xFACAC847, of_the_fix(false, First, "")), // prefer-modern-dom-apis
    (0xFB27139E, One("Prefer ES modules over CommonJS globals.")), // prefer-module
    (0xFB660D51, One("Replace your title with a string")), // valid-title
    (0xFC42BC7F, One("Add the element to the Set initializer array.")), // no-immediate-mutation
    (0xFC4F3444, of_the_fix(false, All, "")), // array-type errorStringArraySimple
    (0xFC854321, One("Add a `yield` expression inside the generator body, or convert it to a regular function if iteration behavior is not needed.")), // require-yield missingYield
    (0xFCA1907E, One("Remove leading `./`")), // relative-url-style
    (0xFCD64168, One("See https://nextjs.org/docs/messages/inline-script-id")), // inline-script-id
    (0xFD4B6DE8, One("Unicode is better supported in `{{good_method}}` than `{{bad_method}}`")), // prefer-code-point
    (0xFD7379FB, One("Use `const` instead.")), // prefer-const useConst
    (0xFE0C8B6D, One("To avoid conflicting with React's new JSX transform: https://reactjs.org/blog/2020/09/22/introducing-the-new-jsx-transform.html")), // jsx-key
    (0xFE1699D3, One("Use a different variable name to avoid shadowing the built-in global.")), // no-redeclare redeclaredAsBuiltin
    (0xFE9DD28C, One("Try to add `onBlur`.")), // mouse-events-have-key-events
    (0xFEB93DCB, One("Use lowercase for the number literal prefix `{{prefix}}`.")), // number-literal-case
    (0xFEE4E16D, One("To avoid confusion around the {} type allowing any non-nullish value, this rule bans usage of the {} type.")), // no-empty-object-type noEmptyInterface
    (0xFEFF2620, Three(&["Remove the type assertion and use a type annotation instead. For example, change `const x = value as Type` to `const x: Type = value`. Alternatively, use the `satisfies` operator: `const x = value satisfies Type`.", "", "Type assertions bypass TypeScript's type checking and can hide type errors. Using type annotations or the `satisfies` operator provides better type safety while still allowing TypeScript to infer types where appropriate."])), // consistent-type-assertions never
    (0xFF0B6D19, One("Replace with `{{good_trim}}`")), // prefer-string-trim-start-end
    (0xFF135B82, One("When writing the `render` method in a component it is easy to forget to return the JSX content. This rule will warn if the `return` statement is missing.")), // require-render-return
    (0xFF321DDB, One("Consider removing or reusing the assigned value.")), // no-useless-assignment unnecessaryAssignment
    (0xFF3DA765, One("consider filling the array with `undefined` values using `Array.prototype.fill()`")), // uninvoked-array-callback
    (0xFF4FF175, One("Prefer a default export")), // prefer-default-export
    (0xFF674826, of_the_fix(false, First, "")), // jsx-boolean-value
    (0xFF73BE67, One("This comparison will always return {{const_result}} as array literals are never equal to each other. Consider using `Array.length` if empty checking was intended.")), // bad-object-literal-comparison
    (0xFFE6404B, of_the_fix(false, First, "")), // operator-assignment unexpected
];
