//! The texts of oxlint for the rules that it shares with ESLint and typescript-eslint, which here are ports of the originals. With a
//! configuration of oxlint a message has the text that oxlint gives it.
//!
//! Made from what oxlint and `bun lint` report at the same places, for the cases of the test suites and for real code: an entry is the
//! text of oxlint in which the values that the rule gives to [`Report::data`](crate::context::Report::data) are replaced by their
//! names, if that makes the text of oxlint of all the pairs with that message id, letter for letter. A message that is not here keeps
//! the text of the original.

use crate::rule::{Message, Meta, Plugin};

/// `message` of the rule `meta`, as oxlint says it.
pub(crate) fn of(meta: &Meta, message: Message) -> Message {
    let plugins: &[&str] = match meta.plugin {
        Plugin::Eslint => &["eslint"],
        // oxlint has the rules that extend one of ESLint under the name of that one.
        Plugin::TypeScript => &["typescript", "eslint"],
        _ => return message,
    };
    let of_rule = |plugin: &&str| {
        let found = MESSAGES.binary_search_by(|it| (it.0, it.1).cmp(&(*plugin, meta.name)));
        Some(MESSAGES.get(found.ok()?)?.2)
    };
    let mut all = plugins.iter().filter_map(of_rule).flatten();
    all.find(|it| it.id == message.id)
        .copied()
        .unwrap_or(message)
}

const fn m(id: &'static str, text: &'static str) -> Message {
    Message::new(id, text)
}

/// Sorted by the plugin and the name, as oxlint calls them.
#[rustfmt::skip]
static MESSAGES: &[(&str, &str, &[Message])] = &[
    ("eslint", "accessor-pairs", &[
        m("missingGetterInPropertyDescriptor", "Setter is defined without a getter"),
        m("missingGetterInObjectLiteral", "Setter is defined without a getter"),
        m("missingSetterInObjectLiteral", "Getter is defined without a setter"),
        m("missingGetterInClass", "Setter is defined without a getter"),
        m("missingSetterInClass", "Getter is defined without a setter"),
        m("missingGetterInType", "Setter is defined without a getter"),
        m("missingSetterInType", "Getter is defined without a setter"),
    ]),
    ("eslint", "array-callback-return", &[
        m("expectedInside", "Callback for array method \"{{arrayMethodName}}\" does not return on all code paths"),
        m("expectedNoReturnValue", "Unexpected return value in callback for \"{{arrayMethodName}}\""),
    ]),
    ("eslint", "arrow-body-style", &[
        m("unexpectedEmptyBlock", "Unexpected empty block statement surrounding arrow body."),
        m("unexpectedObjectBlock", "Unexpected block statement surrounding arrow body."),
        m("unexpectedSingleBlock", "Unexpected block statement surrounding arrow body."),
    ]),
    ("eslint", "block-scoped-var", &[
        m("outOfScope", "'{{name}}' is used outside of binding context."),
    ]),
    ("eslint", "capitalized-comments", &[
        m("unexpectedLowercaseComment", "Comments should not begin with a lowercase letter"),
        m("unexpectedUppercaseComment", "Comments should not begin with an uppercase letter"),
    ]),
    ("eslint", "constructor-super", &[
        m("missingSome", "Lacked a call of `super()` in some code paths."),
        m("missingAll", "Expected to call `super()`."),
        m("badSuper", "Unexpected `super()` because `super` is not a constructor."),
    ]),
    ("eslint", "curly", &[
        m("unexpectedCurlyAfter", "Unexpected { after '{{name}}'."),
        m("unexpectedCurlyAfterCondition", "Unexpected { after '{{name}}' condition."),
    ]),
    ("eslint", "default-case", &[
        m("missingDefaultCase", "Require `default` cases in `switch` statements."),
    ]),
    ("eslint", "default-case-last", &[
        m("notLast", "Enforce default clauses in switch statements to be last"),
    ]),
    ("eslint", "default-param-last", &[
        m("shouldBeLast", "Default parameters should be last"),
    ]),
    ("eslint", "eqeqeq", &[
        m("unexpected", "Expected {{expectedOperator}} and instead saw {{actualOperator}}"),
    ]),
    ("eslint", "for-direction", &[
        m("incorrectDirection", "The update clause in this loop moves the variable in the wrong direction"),
    ]),
    ("eslint", "func-name-matching", &[
        m("notMatchProperty", "Function name `{{funcName}}` should not match property name `{{funcName}}`."),
        m("notMatchVariable", "Function name `{{funcName}}` should not match variable name `{{funcName}}`."),
    ]),
    ("eslint", "getter-return", &[
        m("expected", "Expected to always return a value in getter."),
    ]),
    ("eslint", "guard-for-in", &[
        m("wrap", "Require `for-in` loops to include an `if` statement"),
    ]),
    ("eslint", "id-length", &[
        m("tooShort", "Identifier name is too short (< {{min}})."),
        m("tooShortPrivate", "Identifier name is too short (< {{min}})."),
        m("tooLong", "Identifier name is too long (> {{max}})."),
        m("tooLongPrivate", "Identifier name is too long (> {{max}})."),
    ]),
    ("eslint", "logical-assignment-operators", &[
        m("if", "`if` statement can be replaced with a logical operator assignment with operator `{{operator}}`."),
    ]),
    ("eslint", "max-classes-per-file", &[
        m("maximumExceeded", "File has too many classes ({{classCount}}). Maximum allowed is {{max}}"),
    ]),
    ("eslint", "max-lines", &[
        m("exceed", "File has too many lines ({{actual}})."),
    ]),
    ("eslint", "no-alert", &[
        m("unexpected", "`alert`, `confirm` and `prompt` functions are not allowed"),
    ]),
    ("eslint", "no-array-constructor", &[
        m("preferLiteral", "Avoid calls to the `Array` constructor"),
    ]),
    ("eslint", "no-async-promise-executor", &[
        m("async", "Promise executor functions should not be `async`."),
    ]),
    ("eslint", "no-bitwise", &[
        m("unexpected", "Unexpected use of `\"{{operator}}\"`."),
    ]),
    ("eslint", "no-caller", &[
        m("unexpected", "Do not use `arguments.{{prop}}`."),
    ]),
    ("eslint", "no-class-assign", &[
        m("class", "Unexpected re-assignment of class {{name}}"),
    ]),
    ("eslint", "no-compare-neg-zero", &[
        m("unexpected", "Do not use the {{operator}} operator to compare against -0."),
    ]),
    ("eslint", "no-cond-assign", &[
        m("unexpected", "Expected a conditional expression and instead saw an assignment"),
        m("missing", "Expected a conditional expression and instead saw an assignment"),
    ]),
    ("eslint", "no-console", &[
        m("limited", "Unexpected console statement."),
    ]),
    ("eslint", "no-const-assign", &[
        m("const", "Unexpected re-assignment of `const` variable {{name}}."),
    ]),
    ("eslint", "no-constant-binary-expression", &[
        m("constantBinaryOperand", "Unexpected constant binary expression"),
        m("constantShortCircuit", "Unexpected constant {{property}} on the left-hand side of a \"{{operator}}\" expression"),
        m("alwaysNew", "Unexpected comparison to newly constructed object"),
        m("bothAlwaysNew", "Unexpected comparison of two newly constructed objects"),
        m("constantRelationalComparison", "Unexpected constant relational comparison"),
    ]),
    ("eslint", "no-constant-condition", &[
        m("unexpected", "Unexpected constant condition"),
    ]),
    ("eslint", "no-continue", &[
        m("unexpected", "Unexpected use of `continue` statement."),
    ]),
    ("eslint", "no-debugger", &[
        m("unexpected", "`debugger` statement is not allowed"),
    ]),
    ("eslint", "no-delete-var", &[
        m("unexpected", "Variables should not be deleted"),
    ]),
    ("eslint", "no-dupe-class-members", &[
        m("unexpected", "Duplicate class member: \"{{name}}\""),
    ]),
    ("eslint", "no-dupe-else-if", &[
        m("unexpected", "Duplicate conditions in if-else-if chain"),
    ]),
    ("eslint", "no-dupe-keys", &[
        m("unexpected", "Duplicate key '{{name}}'"),
    ]),
    ("eslint", "no-duplicate-case", &[
        m("unexpected", "Duplicate case label"),
    ]),
    ("eslint", "no-duplicate-imports", &[
        m("import", "'{{module}}' import is duplicated"),
        m("importAs", "'{{module}}' export is duplicated"),
        m("export", "'{{module}}' export is duplicated"),
        m("exportAs", "'{{module}}' export is duplicated"),
    ]),
    ("eslint", "no-else-return", &[
        m("unexpected", "Unnecessary `else` after `return`."),
    ]),
    ("eslint", "no-empty", &[
        m("unexpected", "Unexpected empty block statements"),
    ]),
    ("eslint", "no-empty-character-class", &[
        m("unexpected", "Empty character class will not match anything"),
    ]),
    ("eslint", "no-empty-pattern", &[
        m("unexpected", "Empty {{type}} binding pattern"),
    ]),
    ("eslint", "no-empty-static-block", &[
        m("unexpected", "Unexpected empty static blocks"),
    ]),
    ("eslint", "no-eq-null", &[
        m("unexpected", "Do not use `null` comparisons without type-checking operators."),
    ]),
    ("eslint", "no-eval", &[
        m("unexpected", "eval can be harmful."),
    ]),
    ("eslint", "no-extend-native", &[
        m("unexpected", "{{builtin}} prototype is read-only, properties should not be added."),
    ]),
    ("eslint", "no-extra-boolean-cast", &[
        m("unexpectedCall", "Redundant Boolean call"),
        m("unexpectedNegation", "Redundant double negation"),
    ]),
    ("eslint", "no-extra-label", &[
        m("unexpected", "This label '{{name}}' is unnecessary"),
    ]),
    ("eslint", "no-fallthrough", &[
        m("case", "Expected a `break` statement before `case`."),
        m("default", "Expected a `break` statement before `default`."),
    ]),
    ("eslint", "no-import-assign", &[
        m("readonly", "Do not assign to imported bindings"),
        m("readonlyMember", "Do not assign to imported bindings"),
    ]),
    ("eslint", "no-inline-comments", &[
        m("unexpectedInlineComment", "Unexpected comment inline with code"),
    ]),
    ("eslint", "no-inner-declarations", &[
        m("moveDeclToRoot", "Variable or `function` declarations are not allowed in nested blocks"),
    ]),
    ("eslint", "no-irregular-whitespace", &[
        m("noIrregularWhitespace", "Unexpected irregular whitespace"),
    ]),
    ("eslint", "no-iterator", &[
        m("noIterator", "Reserved name `__iterator__`"),
    ]),
    ("eslint", "no-label-var", &[
        m("identifierClashWithLabel", "Found identifier 'x' with the same name as a label."),
    ]),
    ("eslint", "no-labels", &[
        m("unexpectedLabel", "Labeled statement is not allowed"),
        m("unexpectedLabelInBreak", "Label in break statement is not allowed"),
        m("unexpectedLabelInContinue", "Label in continue statement is not allowed"),
    ]),
    ("eslint", "no-lone-blocks", &[
        m("redundantBlock", "Block is unnecessary."),
    ]),
    ("eslint", "no-lonely-if", &[
        m("unexpectedLonelyIf", "Unexpected `if` as the only statement in an `else` block"),
    ]),
    ("eslint", "no-loop-func", &[
        m("unsafeRefs", "Function declared in a loop contains unsafe references to variable(s)"),
    ]),
    ("eslint", "no-magic-numbers", &[
        m("noMagic", "No magic number: {{raw}}"),
    ]),
    ("eslint", "no-misleading-character-class", &[
        m("surrogatePairWithoutUFlag", "Unexpected surrogate pair in character class."),
        m("combiningClass", "Unexpected combining class in character class."),
        m("emojiModifier", "Unexpected emoji modifier in character class."),
        m("regionalIndicatorSymbol", "Unexpected regional indicator in character class."),
    ]),
    ("eslint", "no-multi-assign", &[
        m("unexpectedChain", "Do not use chained assignment"),
    ]),
    ("eslint", "no-multi-str", &[
        m("multilineString", "Unexpected multi string."),
    ]),
    ("eslint", "no-new-func", &[
        m("noFunctionConstructor", "Using `new Function` or `Function` is not allowed."),
    ]),
    ("eslint", "no-new-wrappers", &[
        m("noConstructor", "Do not use `{{fn}}` as a constructor"),
    ]),
    ("eslint", "no-obj-calls", &[
        m("unexpectedCall", "`{{name}}` is not a function and cannot be called"),
        m("unexpectedRefCall", "`{{name}}` is not a function and cannot be called"),
    ]),
    ("eslint", "no-object-constructor", &[
        m("preferLiteral", "Disallow calls to the `Object` constructor without an argument"),
    ]),
    ("eslint", "no-promise-executor-return", &[
        m("returnsValue", "Return statement should not be used in Promise executor."),
    ]),
    ("eslint", "no-proto", &[
        m("unexpectedProto", "The '__proto__' property is deprecated"),
    ]),
    ("eslint", "no-prototype-builtins", &[
        m("prototypeBuildIn", "do not access Object.prototype method \"{{prop}}\" from target object"),
    ]),
    ("eslint", "no-redeclare", &[
        m("redeclared", "'{{id}}' is already defined."),
    ]),
    ("eslint", "no-regex-spaces", &[
        m("multipleSpaces", "Multiple consecutive spaces are hard to count."),
    ]),
    ("eslint", "no-restricted-imports", &[
        m("pathWithCustomMessage", "'{{importSource}}' import is restricted from being used."),
        m("patternWithCustomMessage", "'{{importSource}}' import is restricted from being used by a pattern."),
        m("patternAndImportNameWithCustomMessage", "'{{importName}}' import from '{{importSource}}' is restricted from being used by a pattern."),
        m("patternAndEverythingWithRegexImportName", "* import is invalid because import name matching '^Foo' pattern from '{{importSource}}' is restricted from being used."),
        m("patternAndEverythingWithRegexImportNameAndCustomMessage", "* import is invalid because import name matching '^Foo' pattern from '{{importSource}}' is restricted from being used."),
        m("importNameWithCustomMessage", "'{{importName}}' import from '{{importSource}}' is restricted."),
        m("allowedImportNamePattern", "'{{importName}}' import from '{{importSource}}' is restricted because only imports that match the pattern '^Foo' are allowed from '{{importSource}}'."),
        m("allowedImportNamePatternWithCustomMessage", "'{{importName}}' import from '{{importSource}}' is restricted because only imports that match the pattern '^Foo' are allowed from '{{importSource}}'."),
        m("everythingWithAllowedImportNamePattern", "* import is invalid because only imports that match the pattern '^Allow' from '{{importSource}}' are allowed."),
        m("everythingWithAllowedImportNamePatternWithCustomMessage", "* import is invalid because only imports that match the pattern '^Allow' from '{{importSource}}' are allowed."),
    ]),
    ("eslint", "no-restricted-properties", &[
        m("restrictedProperty", "'{{propertyName}}' is restricted from being used."),
    ]),
    ("eslint", "no-return-assign", &[
        m("returnAssignment", "Returned expression contains an assignment."),
        m("arrowAssignment", "Returned expression contains an assignment."),
    ]),
    ("eslint", "no-script-url", &[
        m("unexpectedScriptURL", "Unexpected `javascript:` url"),
    ]),
    ("eslint", "no-self-assign", &[
        m("selfAssignment", "this expression is assigned to itself"),
    ]),
    ("eslint", "no-self-compare", &[
        m("comparingToSelf", "Both sides of this comparison are exactly the same"),
    ]),
    ("eslint", "no-sequences", &[
        m("unexpectedCommaExpression", "Unexpected use of comma operator"),
    ]),
    ("eslint", "no-setter-return", &[
        m("returnsValue", "Setter cannot return a value"),
    ]),
    ("eslint", "no-shadow", &[
        m("noShadow", "'{{name}}' is already declared in the upper scope."),
    ]),
    ("eslint", "no-shadow-restricted-names", &[
        m("shadowingRestrictedName", "Shadowing of global properties such as `undefined` is not allowed."),
    ]),
    ("eslint", "no-template-curly-in-string", &[
        m("unexpectedTemplateExpression", "Template placeholders will not interpolate in regular strings"),
    ]),
    ("eslint", "no-ternary", &[
        m("noTernaryOperator", "Unexpected use of ternary expression"),
    ]),
    ("eslint", "no-this-before-super", &[
        m("noBeforeSuper", "Expected to always call `super()` before `this`/`super` property access."),
    ]),
    ("eslint", "no-throw-literal", &[
        m("object", "Expected an error object to be thrown"),
        m("undef", "Do not throw undefined"),
    ]),
    ("eslint", "no-undefined", &[
        m("unexpectedUndefined", "Unexpected use of `undefined`"),
    ]),
    ("eslint", "no-underscore-dangle", &[
        m("unexpectedUnderscore", "Unexpected dangling '_' in '`{{identifier}}`'."),
    ]),
    ("eslint", "no-unexpected-multiline", &[
        m("function", "Unexpected newline between function name and open parenthesis of function call"),
        m("property", "Unexpected newline between object and open bracket of property access"),
        m("taggedTemplate", "Unexpected newline between template tag and template literal"),
        m("division", "Unexpected newline between numerator and division operator"),
    ]),
    ("eslint", "no-unneeded-ternary", &[
        m("unnecessaryConditionalExpression", "Unnecessary use of boolean literals in conditional expression"),
        m("unnecessaryConditionalAssignment", "Unnecessary use of conditional expression for default assignment"),
    ]),
    ("eslint", "no-unsafe-finally", &[
        m("unsafeUsage", "Unsafe `finally` block."),
    ]),
    ("eslint", "no-unsafe-negation", &[
        m("unexpected", "Unexpected negation of the left operand of '{{operator}}' operator."),
    ]),
    ("eslint", "no-unsafe-optional-chaining", &[
        m("unsafeOptionalChain", "Unsafe usage of optional chaining"),
        m("unsafeArithmetic", "Unsafe arithmetic operation on optional chaining"),
    ]),
    ("eslint", "no-unused-expressions", &[
        m("unusedExpression", "Expected expression to be used"),
    ]),
    ("eslint", "no-useless-assignment", &[
        m("unnecessaryAssignment", "This assigned value is not used in subsequent statements."),
    ]),
    ("eslint", "no-useless-backreference", &[
        m("backward", "Backreference '{{bref}}' will be ignored. It references group '{{group}}' which appears later in the pattern."),
        m("disjunctive", "Backreference '{{bref}}' will be ignored. It references group '{{group}}' which is in another alternative."),
        m("intoNegativeLookaround", "Backreference '{{bref}}' will be ignored. It references group '{{group}}' which is in a negative lookaround."),
    ]),
    ("eslint", "no-useless-call", &[
        m("unnecessaryCall", "Avoid unnecessary use of .{{name}}()"),
    ]),
    ("eslint", "no-useless-catch", &[
        m("unnecessaryCatchClause", "Unnecessary catch clause"),
        m("unnecessaryCatch", "Unnecessary try/catch wrapper"),
    ]),
    ("eslint", "no-useless-computed-key", &[
        m("unnecessarilyComputedProperty", "Unnecessarily computed property `{{property}}` found."),
    ]),
    ("eslint", "no-useless-escape", &[
        m("unnecessaryEscape", "Unnecessary escape character '{{character}}'"),
    ]),
    ("eslint", "no-useless-rename", &[
        m("unnecessarilyRenamed", "Do not rename import, export, or destructured assignments to the same name"),
    ]),
    ("eslint", "no-void", &[
        m("noVoid", "Unexpected `void` operator"),
    ]),
    ("eslint", "no-warning-comments", &[
        m("unexpectedComment", "Unexpected '{{matchedTerm}}' comment: {{comment}}"),
    ]),
    ("eslint", "no-with", &[
        m("unexpectedWith", "Unexpected use of `with` statement."),
    ]),
    ("eslint", "prefer-const", &[
        m("useConst", "`{{name}}` is never reassigned."),
    ]),
    ("eslint", "prefer-exponentiation-operator", &[
        m("useExponentiation", "Prefer `**` over `Math.pow`."),
    ]),
    ("eslint", "prefer-named-capture-group", &[
        m("required", "Capture group should be named."),
    ]),
    ("eslint", "prefer-numeric-literals", &[
        m("useLiteral", "Use {{system}} literals instead of parseInt()."),
    ]),
    ("eslint", "prefer-object-has-own", &[
        m("useHasOwn", "Disallow use of `Object.prototype.hasOwnProperty.call()` and prefer use of `Object.hasOwn()`."),
    ]),
    ("eslint", "prefer-object-spread", &[
        m("useSpreadMessage", "Disallow using `Object.assign` with an object literal as the first argument and prefer the use of object spread instead"),
        m("useLiteralMessage", "Disallow using `Object.assign` with an object literal as the first argument and prefer the use of object spread instead"),
    ]),
    ("eslint", "prefer-promise-reject-errors", &[
        m("rejectAnError", "Expected the Promise rejection reason to be an Error"),
    ]),
    ("eslint", "prefer-regex-literals", &[
        m("unexpectedRegExp", "Use a regular expression literal instead of the `RegExp` constructor."),
        m("unexpectedRedundantRegExp", "Regular expression literal is unnecessarily wrapped within a `RegExp` constructor."),
        m("unexpectedRedundantRegExpWithFlags", "Use regular expression literal with flags instead of the `RegExp` constructor."),
    ]),
    ("eslint", "prefer-rest-params", &[
        m("preferRestParams", "Use the rest parameters instead of `arguments`."),
    ]),
    ("eslint", "prefer-spread", &[
        m("preferSpread", "Use spread operators instead of `.apply()`."),
    ]),
    ("eslint", "preserve-caught-error", &[
        m("missingCause", "There is no cause error attached to this new thrown error."),
        m("incorrectCause", "There is no cause error attached to this new thrown error."),
        m("missingCatchErrorParam", "The caught error is not accessible because the catch clause has no error parameter."),
        m("partiallyLostError", "There is no cause error attached to this new thrown error."),
        m("caughtErrorShadowed", "There is no cause error attached to this new thrown error."),
    ]),
    ("eslint", "require-await", &[
        m("missingAwait", "Async function has no `await` expression."),
    ]),
    ("eslint", "require-yield", &[
        m("missingYield", "This generator function does not have `yield`"),
    ]),
    ("eslint", "sort-keys", &[
        m("sortKeys", "Object keys should be sorted"),
    ]),
    ("eslint", "sort-vars", &[
        m("sortVars", "Variable declarations should be sorted"),
    ]),
    ("eslint", "unicode-bom", &[
        m("expected", "Expected Unicode BOM (Byte Order Mark)"),
        m("unexpected", "Unexpected Unicode BOM (Byte Order Mark)"),
    ]),
    ("eslint", "use-isnan", &[
        m("switchNaN", "Checking `switch` discriminant against NaN will never match"),
        m("caseNaN", "Checking for NaN in `case` clause will never match"),
        m("indexOfNaN", "NaN values will never be found by `Array.prototype.{{methodName}}`"),
    ]),
    ("eslint", "valid-typeof", &[
        m("invalidValue", "Invalid `typeof` comparison value."),
        m("notString", "`typeof` comparisons should be to string literals."),
    ]),
    ("eslint", "yoda", &[
        m("expected", "Require or disallow \"Yoda\" conditions"),
    ]),
    ("typescript", "adjacent-overload-signatures", &[
        m("adjacentSignature", "All \"{{name}}\" signatures should be adjacent."),
    ]),
    ("typescript", "ban-ts-comment", &[
        m("tsDirectiveComment", "Do not use @ts-{{directive}} because it alters compilation errors."),
        m("tsDirectiveCommentDescriptionNotMatchPattern", "The description for the @ts-{{directive}} directive must match the {{format}} format."),
        m("tsDirectiveCommentRequiresDescription", "Include a description after the @ts-{{directive}} directive to explain why the @ts-{{directive}} is necessary. The description must be {{minimumDescriptionLength}} characters or longer."),
        m("tsIgnoreInsteadOfExpectError", "Use \"@ts-expect-error\" instead of @ts-ignore, as \"@ts-ignore\" will do nothing if the following line is error-free."),
    ]),
    ("typescript", "consistent-type-assertions", &[
        m("angle-bracket", "Use `<{{cast}}>` instead of `as {{cast}}`."),
        m("as", "Use `as {{cast}}` instead of `<{{cast}}>`."),
        m("unexpectedArrayTypeAssertion", "Always prefer `const x: T[] = [ ... ]`."),
        m("unexpectedObjectTypeAssertion", "Always prefer `const x: T = { ... }`."),
    ]),
    ("typescript", "consistent-type-definitions", &[
        m("interfaceOverType", "Use `interface` instead of `type`."),
        m("typeOverInterface", "Use `type` instead of `interface`."),
    ]),
    ("typescript", "consistent-type-exports", &[
        m("typeOverValue", "All exports in the declaration are only used as types."),
    ]),
    ("typescript", "explicit-module-boundary-types", &[
        m("anyTypedArg", "Argument is explicitly typed as `any`"),
        m("anyTypedArgUnnamed", "Argument is explicitly typed as `any`"),
        m("missingArgType", "Missing argument type on function"),
        m("missingArgTypeUnnamed", "Missing argument type on function"),
        m("missingReturnType", "Missing return type on function"),
    ]),
    ("typescript", "method-signature-style", &[
        m("errorMethod", "Use a property signature instead of a method signature."),
        m("errorProperty", "Use a method signature instead of a property signature."),
    ]),
    ("typescript", "no-array-constructor", &[
        m("useLiteral", "Avoid calls to the `Array` constructor"),
    ]),
    ("typescript", "no-confusing-non-null-assertion", &[
        m("confusingAssign", "Confusing combinations of non-null assertion and assignment like `a! = b`, which looks very similar to not equal `a != b`."),
    ]),
    ("typescript", "no-confusing-void-expression", &[
        m("invalidVoidExpr", "Placing a void expression inside another expression is forbidden."),
        m("invalidVoidExprArrow", "Returning a void expression from an arrow function shorthand is forbidden."),
        m("invalidVoidExprReturn", "Returning a void expression from a function is forbidden."),
        m("invalidVoidExprReturnLast", "Returning a void expression from a function is forbidden."),
    ]),
    ("typescript", "no-duplicate-type-constituents", &[
        m("duplicate", "{{type}} type constituent is duplicated with  {{previous}}."),
    ]),
    ("typescript", "no-empty-interface", &[
        m("noEmpty", "an empty interface is equivalent to `{}`"),
        m("noEmptyWithSuper", "an interface declaring no members is equivalent to its supertype"),
    ]),
    ("typescript", "no-empty-object-type", &[
        m("noEmptyInterface", "Do not use an empty interface declaration."),
        m("noEmptyInterfaceWithSuper", "Do not use an empty interface declaration."),
        m("noEmptyObject", "Do not use the empty object type literal."),
    ]),
    ("typescript", "no-explicit-any", &[
        m("unexpectedAny", "Unexpected `any`. Specify a different type."),
    ]),
    ("typescript", "no-extra-non-null-assertion", &[
        m("noExtraNonNullAssertion", "extra non-null assertion"),
    ]),
    ("typescript", "no-floating-promises", &[
        m("floating", "Promises must be awaited, add await operator."),
        m("floatingPromiseArray", "An array of Promises may be unintentional."),
        m("floatingPromiseArrayVoid", "An array of Promises may be unintentional."),
        m("floatingUselessRejectionHandler", "Promises must be awaited, add await operator."),
        m("floatingUselessRejectionHandlerVoid", "Promises must be awaited, add void operator to ignore."),
        m("floatingVoid", "Promises must be awaited, add void operator to ignore."),
    ]),
    ("typescript", "no-for-in-array", &[
        m("forInViolation", "For-in loops over arrays skips holes, returns indices as strings, and may visit the prototype chain or other enumerable properties."),
    ]),
    ("typescript", "no-implied-eval", &[
        m("noImpliedEvalError", "Implied eval."),
    ]),
    ("typescript", "no-import-type-side-effects", &[
        m("useTopLevelQualifier", "TypeScript will only remove the inline type specifiers which will leave behind a side effect import at runtime."),
    ]),
    ("typescript", "no-inferrable-types", &[
        m("noInferrableType", "Type can be trivially inferred from the initializer"),
    ]),
    ("typescript", "no-invalid-void-type", &[
        m("invalidVoidForGeneric", "Do not use `void` as a type argument for `{{generic}}`."),
        m("invalidVoidNotReturn", "Use `void` only as a return type."),
        m("invalidVoidNotReturnOrGeneric", "Use `void` only as a return type or generic type argument."),
        m("invalidVoidNotReturnOrThisParam", "Use `void` only as a return type or as the type of a `this` parameter."),
        m("invalidVoidNotReturnOrThisParamOrGeneric", "Use `void` only as a return type, generic type argument, or the type of a `this` parameter."),
        m("invalidVoidUnionConstituent", "Remove `void` from this union type constituent."),
    ]),
    ("typescript", "no-misused-spread", &[
        m("noFunctionSpreadInObject", "Using the spread operator on a function without additional properties can cause unexpected behavior."),
        m("noMapSpreadInObject", "Using the spread operator on a Map in an object will result in an empty object."),
        m("noPromiseSpreadInObject", "Using the spread operator on Promise in an object can cause unexpected behavior."),
        m("noStringSpread", "Using the spread operator on a string can mishandle special characters, because it produces Unicode code points, which will break complex characters (like emojis) into multiple parts."),
    ]),
    ("typescript", "no-non-null-asserted-nullish-coalescing", &[
        m("noNonNullAssertedNullishCoalescing", "'Disallow non-null assertions in the left operand of a nullish coalescing operator"),
    ]),
    ("typescript", "no-non-null-asserted-optional-chain", &[
        m("noNonNullOptionalChain", "Optional chain expressions can return undefined by design: using a non-null assertion is unsafe and wrong."),
    ]),
    ("typescript", "no-require-imports", &[
        m("noRequireImports", "Expected \"import\" statement instead of \"require\" call"),
    ]),
    ("typescript", "no-restricted-types", &[
        m("bannedTypeMessage", "Do not use `{{name}}` as a type"),
    ]),
    ("typescript", "no-unnecessary-condition", &[
        m("alwaysNullish", "Unnecessary conditional, value is always nullish."),
        m("comparisonBetweenLiteralTypes", "Unnecessary comparison between literal values."),
        m("neverNullish", "Unnecessary conditional, expected left-hand side of `??` operator to be possibly null or undefined."),
        m("typeGuardAlreadyIsType", "Type predicate is unnecessary as the parameter type already satisfies the predicate."),
    ]),
    ("typescript", "no-unnecessary-parameter-property-assignment", &[
        m("unnecessaryAssign", "Assignment of parameter property is unnecessary"),
    ]),
    ("typescript", "no-unnecessary-type-assertion", &[
        m("contextuallyInferredTypeArguments", "This assertion is unnecessary since it does not change the type of the expression."),
        m("unnecessaryAssertion", "This assertion is unnecessary since it does not change the type of the expression."),
    ]),
    ("typescript", "no-unnecessary-type-constraint", &[
        m("unnecessaryConstraint", "constraining the generic type \"{{name}}\" to \"{{constraint}}\" does nothing and is unnecessary"),
    ]),
    ("typescript", "no-unnecessary-type-conversion", &[
        m("unnecessaryTypeConversion", "This type conversion does not change the type or value of the expression."),
    ]),
    ("typescript", "no-unsafe-argument", &[
        m("unsafeSpread", "Unsafe spread of an any type."),
    ]),
    ("typescript", "no-unsafe-assignment", &[
        m("anyAssignmentThis", "Unsafe assignment of an any value. `this` is typed as {{sender}}.\n"),
        m("unsafeArrayPattern", "Unsafe array destructuring of an any array value."),
        m("unsafeArrayPatternFromTuple", "Unsafe array destructuring of a tuple element with an any value."),
        m("unsafeArraySpread", "Unsafe spread of an any value in an array."),
        m("unsafeAssignment", "Unsafe assignment between incompatible types."),
        m("unsafeObjectPattern", "Unsafe array destructuring of a tuple element with an any value."),
    ]),
    ("typescript", "no-unsafe-call", &[
        m("errorCall", "Unsafe call of a(n) `error` type typed value."),
        m("errorCallThis", "Unsafe call of a(n) `error` type typed value. `this` is typed as `error` type.\n"),
        m("errorNew", "Unsafe construction of a(n) `error` type typed value."),
        m("errorTemplateTag", "Unsafe use of a(n) `error` type typed template tag."),
        m("unsafeCallThis", "Unsafe call of a(n) `any` typed value. `this` is typed as `any`.\n"),
    ]),
    ("typescript", "no-unsafe-function-type", &[
        m("bannedFunctionType", "The `Function` type accepts any function-like value."),
    ]),
    ("typescript", "no-unsafe-member-access", &[
        m("errorComputedMemberAccess", "Computed name {{property}} resolves to an `error` typed value."),
        m("errorMemberExpression", "Unsafe member access {{property}} on an `error` typed value."),
        m("unsafeThisMemberExpression", "Unsafe member access {{property}} on an `any` value. `this` is typed as `any`."),
    ]),
    ("typescript", "no-unsafe-return", &[
        m("unsafeReturnThis", "Unsafe return of a value of type `{{type}}`. `this` is typed as {{type}}."),
    ]),
    ("typescript", "no-unsafe-type-assertion", &[
        m("unsafeToUnconstrainedTypeAssertion", "Unsafe type assertion: '{{type}}' could be instantiated with an arbitrary type which could be unrelated to the original type."),
    ]),
    ("typescript", "no-useless-empty-export", &[
        m("uselessExport", "Empty exports do nothing in module files"),
    ]),
    ("typescript", "no-wrapper-object-types", &[
        m("bannedClassType", "Do not use wrapper object types."),
    ]),
    ("typescript", "prefer-as-const", &[
        m("preferConstAssertion", "Expected a `const` assertion instead of a literal type annotation."),
    ]),
    ("typescript", "prefer-enum-initializers", &[
        m("defineInitializer", "The value of the member \"{{name}}\" should be explicitly defined."),
    ]),
    ("typescript", "prefer-for-of", &[
        m("preferForOf", "Expected a `for...of` loop instead of a `for` loop with this simple iteration."),
    ]),
    ("typescript", "prefer-function-type", &[
        m("functionTypeOverCallableType", "Enforce using function types instead of interfaces with call signatures."),
        m("unexpectedThisOnFunctionOnlyInterface", "Enforce using function types instead of interfaces with call signatures."),
    ]),
    ("typescript", "prefer-literal-enum-member", &[
        m("notLiteral", "Explicit enum values must only be literal values (string, number, boolean, etc.)."),
        m("notLiteralOrBitwiseExpression", "Explicit enum values must only be literal values (string, number, boolean, etc.)."),
    ]),
    ("typescript", "prefer-namespace-keyword", &[
        m("useNamespace", "Use `namespace` instead of `module` to declare custom TypeScript modules."),
    ]),
    ("typescript", "prefer-nullish-coalescing", &[
        m("preferNullishOverTernary", "Prefer using nullish coalescing operator (`??`) instead of a ternary expression, as it is simpler to read."),
    ]),
    ("typescript", "prefer-promise-reject-errors", &[
        m("rejectAnError", "Expected the Promise rejection reason to be an Error."),
    ]),
    ("typescript", "prefer-readonly", &[
        m("preferReadonly", "Member '{{name}}' is never reassigned."),
    ]),
    ("typescript", "prefer-readonly-parameter-types", &[
        m("shouldBeReadonly", "Parameter should be a readonly type."),
    ]),
    ("typescript", "prefer-string-starts-ends-with", &[
        m("preferEndsWith", "Use 'String#endsWith' method instead."),
    ]),
    ("typescript", "prefer-ts-expect-error", &[
        m("preferExpectErrorComment", "Enforce using `@ts-expect-error` over `@ts-ignore`"),
    ]),
    ("typescript", "promise-function-async", &[
        m("missingAsyncHybridReturn", "Functions that return promises must be async."),
    ]),
    ("typescript", "require-await", &[
        m("missingAwait", "Function has no 'await' expression."),
    ]),
    ("typescript", "restrict-plus-operands", &[
        m("bigintAndNumber", "Numeric '+' operations must either be both bigints or both numbers."),
        m("invalid", "Invalid operand of type '{{type}}' for a '+' operation."),
        m("mismatched", "Operands of '+' operations must be of the same type."),
    ]),
    ("typescript", "restrict-template-expressions", &[
        m("invalidType", "Invalid type used in template literal expression."),
    ]),
    ("typescript", "strict-boolean-expressions", &[
        m("conditionErrorAny", "Unexpected any value in conditional."),
        m("conditionErrorNullableBoolean", "Unexpected nullable boolean value in conditional."),
        m("conditionErrorNullableEnum", "Unexpected nullable enum value in conditional."),
        m("conditionErrorNullableNumber", "Unexpected nullable number value in conditional."),
        m("conditionErrorNullableObject", "Unexpected nullable object value in conditional."),
        m("conditionErrorNullableString", "Unexpected nullable string value in conditional."),
        m("conditionErrorNullish", "Unexpected nullish value in conditional. The expression is always falsy."),
        m("conditionErrorNumber", "Unexpected number value in conditional. A number can be falsy (0, NaN) or truthy."),
        m("conditionErrorString", "Unexpected string value in conditional. A string can be falsy (empty string) or truthy."),
    ]),
    ("typescript", "unbound-method", &[
        m("unbound", "Avoid referencing unbound methods which may cause unintentional scoping of `this`."),
        m("unboundWithoutThisAnnotation", "Avoid referencing unbound methods which may cause unintentional scoping of `this`."),
    ]),
    ("typescript", "use-unknown-in-catch-callback-variable", &[
        m("useUnknownArrayDestructuringPattern", "Prefer the safe `: unknown` for a `{{method}}` callback variable. The thrown error may not be iterable."),
        m("useUnknownObjectDestructuringPattern", "Prefer the safe `: unknown` for a `{{method}}` callback variable. The thrown error may be nullable, or may not have the expected shape."),
    ]),
];
