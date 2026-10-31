import * as b from "../../codegen/bindgen-lib.ts";

const js = { capability: "js", throws: true } as const;

/** `expect(received).toBeTrue()` */
const matcher = { returns: b.any.returning("undefined"), passThis: true, ...js } as const;
/** `expect(received).toBe(expected)` */
const matcherWithExpected = { ...matcher, args: { expected: b.any } } as const;
/** `expect(mock).toHaveBeenCalledWith(...expected)` */
const matcherWithCallArguments = { ...matcher, args: { expected: b.any.variadic } } as const;
const matcherWithNthCallArguments = { ...matcher, args: { nth: b.any, expected: b.any.variadic }, length: 0 } as const;
const matcherWithNthExpected = { ...matcher, args: { nth: b.any, expected: b.any }, length: 1 } as const;
/** These return `this`. */
const chainable = { ...matcher, returns: b.any.returning("this") } as const;
const chainableWithExpected = { ...chainable, args: { expected: b.any } } as const;

export const ExpectAnything = b.class({ rustPath: "crate::test_runner::ExpectAnything" });

export const ExpectAny = b.class({
  rustPath: "crate::test_runner::ExpectAny",
  internalFields: ["constructorValue"],
});

export const ExpectArrayContaining = b.class({
  rustPath: "crate::test_runner::ExpectArrayContaining",
  internalFields: ["arrayValue"],
});

export const ExpectCloseTo = b.class({
  rustPath: "crate::test_runner::ExpectCloseTo",
  internalFields: ["numberValue", "digitsValue"],
});

export const ExpectObjectContaining = b.class({
  rustPath: "crate::test_runner::ExpectObjectContaining",
  internalFields: ["objectValue"],
});

export const ExpectStringContaining = b.class({
  rustPath: "crate::test_runner::ExpectStringContaining",
  internalFields: ["stringValue"],
});

export const ExpectStringMatching = b.class({
  rustPath: "crate::test_runner::ExpectStringMatching",
  internalFields: ["testValue"],
});

/** `expect.any(Number)`, and the same after `expect.not`. */
const asymmetricMatchers = {
  any: { args: { constructor: b.any }, returns: ExpectAny, ...js },
  anything: { returns: ExpectAnything, capability: "js", length: 1 },
  arrayContaining: { args: { array: b.any }, returns: ExpectArrayContaining, ...js },
  closeTo: { args: { number: b.any, precision: b.any }, returns: ExpectCloseTo, ...js, length: 1 },
  objectContaining: { args: { object: b.any }, returns: ExpectObjectContaining, ...js },
  stringContaining: { args: { string: b.any }, returns: ExpectStringContaining, ...js },
  stringMatching: { args: { test: b.any }, returns: ExpectStringMatching, ...js },
} as const;

/** `expect.not`, `expect.resolvesTo` and `expect.rejectsTo` */
export const ExpectStatic = b.class({
  rustPath: "crate::test_runner::ExpectStatic",
  proto: {
    any: asymmetricMatchers.any,
    anything: asymmetricMatchers.anything,
    arrayContaining: asymmetricMatchers.arrayContaining,
    closeTo: asymmetricMatchers.closeTo,
    not: { getter: b.self, capability: "heap" },
    objectContaining: asymmetricMatchers.objectContaining,
    rejectsTo: { getter: b.self, capability: "heap", throws: true },
    resolvesTo: { getter: b.self, capability: "heap", throws: true },
    stringContaining: asymmetricMatchers.stringContaining,
    stringMatching: asymmetricMatchers.stringMatching,
  },
});

export const Expect = b.class({
  rustPath: "crate::test_runner::Expect",
  construct: { capability: "heap", throws: true },
  call: { args: { value: b.any, message: b.any }, returns: b.self, ...js },
  internalFields: ["capturedValue"],
  proto: {
    fail: { args: { message: b.any }, returns: b.any.returning("undefined"), ...js },
    lastCalledWith: { ...matcherWithCallArguments, rustName: "to_have_been_last_called_with" },
    lastReturnedWith: { ...matcherWithExpected, rustName: "to_have_last_returned_with" },
    not: { getter: b.self, passThis: true },
    nthCalledWith: { ...matcherWithNthCallArguments, rustName: "to_have_been_nth_called_with" },
    nthReturnedWith: { ...matcherWithNthExpected, rustName: "to_have_nth_returned_with" },
    pass: { args: { message: b.any }, returns: b.any.returning("undefined"), ...js },
    rejects: { getter: b.self, capability: "heap", throws: true, passThis: true },
    resolves: { getter: b.self, capability: "heap", throws: true, passThis: true },
    toBe: matcherWithExpected,
    toBeArray: matcher,
    toBeArrayOfSize: { ...matcher, args: { size: b.any } },
    toBeBoolean: matcher,
    toBeCalled: { ...matcherWithExpected, rustName: "to_have_been_called", length: 0 },
    toBeCalledTimes: { ...matcherWithExpected, rustName: "to_have_been_called_times" },
    toBeCalledWith: { ...matcherWithCallArguments, rustName: "to_have_been_called_with" },
    toBeCloseTo: { ...matcher, args: { expected: b.any, precision: b.any }, length: 1 },
    toBeDate: matcher,
    toBeDefined: matcher,
    toBeEmpty: matcher,
    toBeEmptyObject: chainable,
    toBeEven: matcher,
    toBeFalse: matcher,
    toBeFalsy: matcher,
    toBeFinite: matcher,
    toBeFunction: matcher,
    toBeGreaterThan: matcherWithExpected,
    toBeGreaterThanOrEqual: matcherWithExpected,
    toBeInstanceOf: matcherWithExpected,
    toBeInteger: matcher,
    toBeLessThan: matcherWithExpected,
    toBeLessThanOrEqual: matcherWithExpected,
    toBeNaN: { ...matcher, rustName: "to_be_nan" },
    toBeNegative: matcher,
    toBeNil: matcher,
    toBeNull: matcher,
    toBeNumber: matcher,
    toBeObject: chainable,
    toBeOdd: matcher,
    toBeOneOf: matcherWithExpected,
    toBePositive: matcher,
    toBeString: matcher,
    toBeSymbol: matcher,
    toBeTrue: matcher,
    toBeTruthy: matcher,
    toBeTypeOf: matcherWithExpected,
    toBeUndefined: matcher,
    toBeValidDate: chainable,
    toBeWithin: { ...matcher, args: { start: b.any, end: b.any } },
    toContain: matcherWithExpected,
    toContainAllKeys: chainableWithExpected,
    toContainAllValues: chainableWithExpected,
    toContainAnyKeys: chainableWithExpected,
    toContainAnyValues: chainableWithExpected,
    toContainEqual: chainableWithExpected,
    toContainKey: chainableWithExpected,
    toContainKeys: chainableWithExpected,
    toContainValue: chainableWithExpected,
    toContainValues: chainableWithExpected,
    toEndWith: matcherWithExpected,
    toEqual: matcherWithExpected,
    toEqualIgnoringWhitespace: matcherWithExpected,
    /** Throws when it is given an argument. */
    toHaveBeenCalled: { ...matcherWithExpected, length: 0 },
    toHaveBeenCalledOnce: matcher,
    toHaveBeenCalledTimes: matcherWithExpected,
    toHaveBeenCalledWith: matcherWithCallArguments,
    toHaveBeenLastCalledWith: matcherWithCallArguments,
    toHaveBeenNthCalledWith: matcherWithNthCallArguments,
    toHaveLastReturnedWith: matcherWithExpected,
    toHaveLength: matcherWithExpected,
    toHaveNthReturnedWith: matcherWithNthExpected,
    /** `toHaveProperty("a", undefined)` compares the value, `toHaveProperty("a")` does not. */
    toHaveProperty: { ...matcher, args: { keyPath: b.any, value: b.any.variadic }, length: 2 },
    toHaveReturned: matcherWithExpected,
    toHaveReturnedTimes: matcherWithExpected,
    toHaveReturnedWith: matcherWithExpected,
    toInclude: matcherWithExpected,
    toIncludeRepeated: { ...matcher, args: { substring: b.any, count: b.any } },
    toMatch: matcherWithExpected,
    /** The snapshot is written over the call's arguments in the source, where `(undefined)` is not `()`. */
    toMatchInlineSnapshot: { ...matcher, args: { args: b.any.variadic }, length: 1 },
    toMatchObject: matcherWithExpected,
    toMatchSnapshot: { ...matcher, args: { propertyMatchers: b.any, hint: b.any }, length: 1 },
    toReturn: { ...matcherWithExpected, rustName: "to_have_returned" },
    toSatisfy: { ...matcher, args: { predicate: b.any } },
    toStartWith: matcherWithExpected,
    toStrictEqual: matcherWithExpected,
    toThrow: matcherWithExpected,
    toThrowError: { ...matcherWithExpected, rustName: "to_throw" },
    /** As `toMatchInlineSnapshot`. */
    toThrowErrorMatchingInlineSnapshot: { ...matcher, args: { args: b.any.variadic }, length: 1 },
    toThrowErrorMatchingSnapshot: { ...matcher, args: { hint: b.any } },
  },
  static: {
    addSnapshotSerializer: { capability: "heap", throws: true, length: 1 },
    any: asymmetricMatchers.any,
    anything: asymmetricMatchers.anything,
    arrayContaining: asymmetricMatchers.arrayContaining,
    assertions: { args: { expected: b.any }, ...js },
    closeTo: asymmetricMatchers.closeTo,
    extend: { args: { matchers: b.any }, ...js },
    hasAssertions: { ...js, length: 1 },
    not: { getter: ExpectStatic, capability: "heap", rustName: "static_not" },
    objectContaining: asymmetricMatchers.objectContaining,
    rejectsTo: { getter: ExpectStatic, capability: "heap", rustName: "static_rejects_to" },
    resolvesTo: { getter: ExpectStatic, capability: "heap", rustName: "static_resolves_to" },
    stringContaining: asymmetricMatchers.stringContaining,
    stringMatching: asymmetricMatchers.stringMatching,
    unreachable: { args: { message: b.any }, ...js },
  },
});

/** What `expect.extend()` wraps each matcher in. The callee holds the matcher. */
export const applyCustomMatcher = b.fn({
  export: "Bun__Expect__applyCustomMatcher",
  rustPath: "crate::test_runner::Expect::apply_custom_matcher",
  passThis: true,
  passCallee: true,
  args: { args: b.any.variadic },
  returns: b.any,
  ...js,
});

/** What a matcher of `expect.extend()` makes when it is called on `expect` itself. */
export const ExpectCustomAsymmetricMatcher = b.class({
  rustPath: "crate::test_runner::ExpectCustomAsymmetricMatcher",
  internalFields: ["matcherFn", "capturedArgs"],
  proto: {
    asymmetricMatch: { args: { received: b.any }, returns: b.bool, passThis: true, ...js },
  },
});

/** The `this` of a matcher of `expect.extend()`. */
export const ExpectMatcherContext = b.class({
  rustPath: "crate::test_runner::ExpectMatcherContext",
  proto: {
    equals: { args: { a: b.any, b: b.any }, returns: b.bool, ...js, length: 3 },
    expand: { getter: b.bool, pure: true },
    isNot: { getter: b.bool, pure: true },
    promise: { getter: b.string },
    utils: { getter: b.any.returning("ExpectMatcherUtils"), capability: "js" },
  },
});

const printer = { args: { value: b.any }, returns: b.any.returning("string"), ...js } as const;

/** `this.utils` in a matcher of `expect.extend()`. */
export const ExpectMatcherUtils = b.class({
  rustPath: "crate::test_runner::ExpectMatcherUtils",
  proto: {
    EXPECTED_COLOR: { ...printer, rustName: "print_expected" },
    /** `matcherHint("toBe", undefined)` prints no "received", `matcherHint("toBe")` does. */
    matcherHint: { args: { matcherName: b.any, rest: b.any.variadic }, returns: b.any.returning("string"), ...js },
    printExpected: printer,
    printReceived: printer,
    RECEIVED_COLOR: { ...printer, rustName: "print_received" },
    stringify: printer,
  },
});

const typeAssertion = { length: 1, rustName: "type_assertion" } as const;
const typeProperty = { getter: b.self, capability: "heap", rustName: "type_property" } as const;

/** Only the type checker looks at `expectTypeOf()`: at run time nothing is checked. */
export const ExpectTypeOf = b.class({
  rustPath: "crate::test_runner::ExpectTypeOf",
  construct: { capability: "heap", throws: true },
  call: { returns: b.self, capability: "heap" },
  proto: {
    asserts: typeProperty,
    branded: typeProperty,
    constructorParameters: typeProperty,
    exclude: typeAssertion,
    extract: typeAssertion,
    guards: typeProperty,
    instance: typeProperty,
    items: typeProperty,
    map: { returns: b.self, capability: "heap", length: 1 },
    not: typeProperty,
    omit: typeAssertion,
    parameter: typeAssertion,
    parameters: typeProperty,
    pick: typeAssertion,
    resolves: typeProperty,
    returns: typeProperty,
    thisParameter: typeProperty,
    toBeAny: typeAssertion,
    toBeArray: typeAssertion,
    toBeBigInt: typeAssertion,
    toBeBoolean: typeAssertion,
    toBeCallableWith: typeAssertion,
    toBeConstructibleWith: typeAssertion,
    toBeFunction: typeAssertion,
    toBeNever: typeAssertion,
    toBeNull: typeAssertion,
    toBeNumber: typeAssertion,
    toBeObject: typeAssertion,
    toBeString: typeAssertion,
    toBeSymbol: typeAssertion,
    toBeUndefined: typeAssertion,
    toBeUnknown: typeAssertion,
    toBeVoid: typeAssertion,
    toEqualTypeOf: typeAssertion,
    toExtend: typeAssertion,
    toHaveProperty: typeAssertion,
    toMatchObjectType: typeAssertion,
    toMatchTypeOf: typeAssertion,
  },
});
