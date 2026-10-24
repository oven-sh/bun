import * as b from "../../codegen/bindgen-lib.ts";

const js = { capability: "js", throws: true } as const;

const regExp = b.cell("JSC::RegExpObject", "JavaScriptCore/RegExpObject.h", {
  rustPath: "bun_jsc::JSObject",
  reportedAs: "RegExp",
  tsType: "RegExp",
});
const arrayBuffer = b.cell("JSC::JSArrayBuffer", "JavaScriptCore/JSArrayBuffer.h", {
  rustPath: "bun_jsc::JSObject",
  tsType: "ArrayBuffer | SharedArrayBuffer",
});
const arrayBufferView = b.cell("JSC::JSArrayBufferView", "JavaScriptCore/JSArrayBufferView.h", {
  rustPath: "bun_jsc::JSObject",
  tsType: "ArrayBufferView",
});

export const NumberOrBigInt = b.union({ number: b.f64, bigInt: b.bigInt, other: b.ignored });
export const ObjectOrOther = b.union({ object: b.object, other: b.ignored });
export const StringValue = b.union({ string: b.jsString, stringObject: b.stringObject, other: b.ignored });
export const StringOrRegExp = b.union({ string: b.stringLike, regExp, other: b.ignored });
/** What is walked by index, and what may be iterable. A `DataView` has no elements. */
export const ExpectArrayLike = b.union({
  list: b.jsArray,
  dataView: b.dataView,
  arrayBuffer,
  typedArray: arrayBufferView,
  other: b.ignored,
});
/** A message, or an object: a pattern, a class, an asymmetric matcher or an error with the same message. */
export const ExpectedError = b.union({
  missing: b.undefined,
  string: b.jsString,
  object: b.object,
  other: b.ignored,
});
/** `undefined` is 2 digits. */
export const ExpectPrecision = b.union({ missing: b.undefined, digits: b.f64, other: b.ignored });
/** A `String` object is a string where a string fits, else an object. */
export const SnapshotArgument = b.union({
  missing: b.undefined,
  string: b.jsString,
  stringObject: b.stringObject,
  object: b.object,
  other: b.ignored,
});

/** `expect(received).toBeTrue()` */
const matcher = { passThis: true, ...js } as const;
/** `expect(received).toBe(expected)` */
const matcherWithExpected = { ...matcher, args: { expected: b.opaque } } as const;
const matcherWithExpectedString = { ...matcher, args: { expected: b.stringLike.otherAsNull }, length: 1 } as const;
const matcherWithExpectedNumber = { ...matcher, args: { expected: b.f64.otherAsNull }, length: 1 } as const;
const matcherWithExpectedOrdered = { ...matcher, args: { expected: NumberOrBigInt.withValue } } as const;
const matcherWithExpectedError = { ...matcher, args: { expected: ExpectedError.withValue } } as const;
/** Throws when it is given an argument. */
const matcherWithoutArgument = { ...matcher, args: { expected: b.opaque.optional } } as const;
/** `expect(received).toBeObject().toContainKey(expected)` */
const chainableMatcher = { ...matcher, returns: b.self } as const;
const chainableMatcherWithExpected = { ...matcherWithExpected, returns: b.self } as const;
const chainableMatcherWithExpectedArray = {
  ...chainableMatcher,
  args: { expected: b.jsArray.otherAsNull },
  length: 1,
} as const;
/** `expect(mock).toHaveBeenCalledWith(...expected)` */
const matcherWithCallArguments = { ...matcher, args: { expected: b.rest(b.opaque) } } as const;
const matcherWithNthCallArguments = {
  ...matcher,
  args: { nth: b.f64.otherAsNull, expected: b.rest(b.opaque) },
  length: 0,
} as const;
const matcherWithNthExpected = { ...matcher, args: { nth: b.f64.otherAsNull, expected: b.opaque }, length: 1 } as const;

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

export const ConstructorArgument = b.union({ missing: b.undefined, object: b.object, other: b.ignored });

/** `expect.any(Number)`, and the same after `expect.not`. */
const asymmetricMatchers = {
  any: { args: { constructor: ConstructorArgument }, returns: ExpectAny, ...js },
  anything: { returns: ExpectAnything, capability: "js", length: 1 },
  arrayContaining: { args: { array: b.jsArray.otherAsNull }, returns: ExpectArrayContaining, ...js, length: 1 },
  closeTo: {
    args: { number: b.f64.otherAsNull.withValue, precision: ExpectPrecision.withValue },
    returns: ExpectCloseTo,
    ...js,
    length: 1,
  },
  objectContaining: { args: { object: b.object.otherAsNull }, returns: ExpectObjectContaining, ...js, length: 1 },
  stringContaining: { args: { string: b.stringLike.otherAsNull }, returns: ExpectStringContaining, ...js, length: 1 },
  stringMatching: { args: { test: StringOrRegExp }, returns: ExpectStringMatching, ...js },
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

/** An object is the label if it has a `toString` method. */
export const ExpectLabel = b.union({ string: b.stringLike, object: b.object, other: b.ignored });

/** `null` and `undefined` are the default message. What is not a string is thrown as it is. */
export const UnreachableMessage = b.union({
  absent: b.undefined,
  none: b.null,
  text: b.string.allowStringObject,
  thrown: b.opaque,
});

export const Expect = b.class({
  rustPath: "crate::test_runner::Expect",
  construct: { capability: "heap", throws: true },
  call: { args: { value: b.opaque, message: ExpectLabel }, returns: b.self, ...js },
  internalFields: ["capturedValue"],
  proto: {
    fail: {
      args: { message: b.string.allowStringObject.optional },
      expected: { message: "Expected message to be a string for 'fail'." },
      ...js,
      length: 1,
    },
    lastCalledWith: { ...matcherWithCallArguments, rustName: "to_have_been_last_called_with" },
    lastReturnedWith: { ...matcherWithExpected, rustName: "to_have_last_returned_with" },
    not: { getter: b.self, passThis: true },
    nthCalledWith: { ...matcherWithNthCallArguments, rustName: "to_have_been_nth_called_with" },
    nthReturnedWith: { ...matcherWithNthExpected, rustName: "to_have_nth_returned_with" },
    pass: {
      args: { message: b.string.allowStringObject.optional },
      expected: { message: "Expected message to be a string for 'pass'." },
      ...js,
      length: 1,
    },
    rejects: { getter: b.self, capability: "heap", throws: true, passThis: true },
    resolves: { getter: b.self, capability: "heap", throws: true, passThis: true },
    toBe: matcherWithExpected,
    toBeArray: matcher,
    toBeArrayOfSize: { ...matcher, args: { size: b.f64.otherAsNull }, length: 1 },
    toBeBoolean: matcher,
    toBeCalled: { ...matcherWithoutArgument, rustName: "to_have_been_called" },
    toBeCalledTimes: { ...matcherWithExpectedNumber, rustName: "to_have_been_called_times" },
    toBeCalledWith: { ...matcherWithCallArguments, rustName: "to_have_been_called_with" },
    toBeCloseTo: { ...matcher, args: { expected: b.f64.otherAsNull, precision: ExpectPrecision }, length: 1 },
    toBeDate: matcher,
    toBeDefined: matcher,
    toBeEmpty: matcher,
    toBeEmptyObject: chainableMatcher,
    toBeEven: matcher,
    toBeFalse: matcher,
    toBeFalsy: matcher,
    toBeFinite: matcher,
    toBeFunction: matcher,
    toBeGreaterThan: matcherWithExpectedOrdered,
    toBeGreaterThanOrEqual: matcherWithExpectedOrdered,
    toBeInstanceOf: { ...matcher, args: { expected: ObjectOrOther.withValue } },
    toBeInteger: matcher,
    toBeLessThan: matcherWithExpectedOrdered,
    toBeLessThanOrEqual: matcherWithExpectedOrdered,
    toBeNaN: { ...matcher, rustName: "to_be_nan" },
    toBeNegative: matcher,
    toBeNil: matcher,
    toBeNull: matcher,
    toBeNumber: matcher,
    toBeObject: chainableMatcher,
    toBeOdd: matcher,
    toBeOneOf: { ...matcher, args: { expected: ExpectArrayLike.withValue } },
    toBePositive: matcher,
    toBeString: matcher,
    toBeSymbol: matcher,
    toBeTrue: matcher,
    toBeTruthy: matcher,
    toBeTypeOf: matcherWithExpectedString,
    toBeUndefined: matcher,
    toBeValidDate: chainableMatcher,
    toBeWithin: { ...matcher, args: { start: b.f64.otherAsNull, end: b.f64.otherAsNull }, length: 2 },
    toContain: { ...matcher, args: { expected: StringValue.withValue } },
    toContainAllKeys: chainableMatcherWithExpectedArray,
    toContainAllValues: chainableMatcherWithExpectedArray,
    toContainAnyKeys: chainableMatcherWithExpectedArray,
    toContainAnyValues: chainableMatcherWithExpectedArray,
    toContainEqual: { ...chainableMatcher, args: { expected: StringValue.withValue } },
    toContainKey: chainableMatcherWithExpected,
    toContainKeys: chainableMatcherWithExpectedArray,
    toContainValue: chainableMatcherWithExpected,
    toContainValues: chainableMatcherWithExpectedArray,
    toEndWith: matcherWithExpectedString,
    toEqual: matcherWithExpected,
    toEqualIgnoringWhitespace: matcherWithExpectedString,
    toHaveBeenCalled: matcherWithoutArgument,
    toHaveBeenCalledOnce: matcher,
    toHaveBeenCalledTimes: matcherWithExpectedNumber,
    toHaveBeenCalledWith: matcherWithCallArguments,
    toHaveBeenLastCalledWith: matcherWithCallArguments,
    toHaveBeenNthCalledWith: matcherWithNthCallArguments,
    toHaveLastReturnedWith: matcherWithExpected,
    toHaveLength: { ...matcher, args: { expected: b.f64.otherAsNull.withValue }, length: 1 },
    toHaveNthReturnedWith: matcherWithNthExpected,
    /** `toHaveProperty("a", undefined)` compares the value, `toHaveProperty("a")` does not. */
    toHaveProperty: { ...matcher, args: { keyPath: StringValue.withValue, value: b.opaque.ifPassed }, length: 2 },
    toHaveReturned: { ...matcherWithoutArgument, length: 1 },
    toHaveReturnedTimes: matcherWithExpectedNumber,
    toHaveReturnedWith: matcherWithExpected,
    toInclude: matcherWithExpectedString,
    toIncludeRepeated: {
      ...matcher,
      args: { substring: b.stringLike.otherAsNull, count: b.f64.otherAsNull },
      length: 2,
    },
    toMatch: { ...matcher, args: { expected: StringOrRegExp.withValue } },
    /** The snapshot is written over the call's arguments in the source, where `(undefined)` is not `()`. */
    toMatchInlineSnapshot: {
      ...matcher,
      args: { first: SnapshotArgument.ifPassed, second: SnapshotArgument.ifPassed },
      length: 1,
    },
    toMatchObject: { ...matcher, args: { expected: b.object.otherAsNull }, length: 1 },
    toMatchSnapshot: { ...matcher, args: { propertyMatchers: SnapshotArgument, hint: SnapshotArgument }, length: 1 },
    toReturn: { ...matcherWithoutArgument, rustName: "to_have_returned", length: 1 },
    toSatisfy: { ...matcher, args: { predicate: b.callable.otherAsNull }, length: 1 },
    toStartWith: matcherWithExpectedString,
    toStrictEqual: matcherWithExpected,
    toThrow: matcherWithExpectedError,
    toThrowError: { ...matcherWithExpectedError, rustName: "to_throw" },
    /** As `toMatchInlineSnapshot`. */
    toThrowErrorMatchingInlineSnapshot: {
      ...matcher,
      args: { snapshot: SnapshotArgument.ifPassed, extra: b.opaque.ifPassed },
      length: 1,
    },
    toThrowErrorMatchingSnapshot: { ...matcher, args: { hint: SnapshotArgument } },
  },
  static: {
    addSnapshotSerializer: { capability: "heap", throws: true, length: 1 },
    any: asymmetricMatchers.any,
    anything: asymmetricMatchers.anything,
    arrayContaining: asymmetricMatchers.arrayContaining,
    assertions: { args: { expected: b.f64.otherAsNull.withValue }, ...js, length: 1 },
    closeTo: asymmetricMatchers.closeTo,
    extend: { args: { matchers: b.object.otherAsNull }, ...js, length: 1 },
    hasAssertions: { ...js, length: 1 },
    not: { getter: ExpectStatic, capability: "heap", rustName: "static_not" },
    objectContaining: asymmetricMatchers.objectContaining,
    rejectsTo: { getter: ExpectStatic, capability: "heap", rustName: "static_rejects_to" },
    resolvesTo: { getter: ExpectStatic, capability: "heap", rustName: "static_resolves_to" },
    stringContaining: asymmetricMatchers.stringContaining,
    stringMatching: asymmetricMatchers.stringMatching,
    unreachable: { args: { message: UnreachableMessage }, ...js },
  },
});

/** What `expect.extend()` wraps each matcher in. The callee holds the matcher. */
export const applyCustomMatcher = b.fn({
  export: "Bun__Expect__applyCustomMatcher",
  rustPath: "crate::test_runner::Expect::apply_custom_matcher",
  passThis: true,
  passCallee: true,
  args: { args: b.rest(b.opaque) },
  returns: b.object,
  ...js,
});

/** What a matcher of `expect.extend()` makes when it is called on `expect` itself. */
export const ExpectCustomAsymmetricMatcher = b.class({
  rustPath: "crate::test_runner::ExpectCustomAsymmetricMatcher",
  internalFields: ["matcherFn", "capturedArgs"],
  proto: {
    asymmetricMatch: { args: { received: b.opaque }, returns: b.bool, passThis: true, ...js },
  },
});

const printer = { args: { value: b.opaque }, returns: b.string.utf8, ...js } as const;

/** Only `isNot` changes the hint. The others are converted and not used. */
export const MatcherHintOptions = b.dictionary(
  {
    isNot: b.bool.loose.default(false),
    comment: b.string.loose.optional,
    promise: b.string.loose.optional,
    secondArgument: b.string.loose.optional,
  },
  { allowArray: true },
);
export const MatcherHintOptionsOrOther = b.union({ options: MatcherHintOptions, other: b.ignored }, { fromJS: true });

/** `this.utils` in a matcher of `expect.extend()`. */
export const ExpectMatcherUtils = b.class({
  rustPath: "crate::test_runner::ExpectMatcherUtils",
  proto: {
    EXPECTED_COLOR: { ...printer, rustName: "print_expected" },
    /** `matcherHint("toBe", undefined)` prints no "received", `matcherHint("toBe")` does. */
    matcherHint: {
      args: {
        matcherName: b.string.allowStringObject.otherAsNull,
        received: b.opaque.ifPassed,
        expected: b.opaque.ifPassed,
        options: b.opaque.nullable,
      },
      returns: b.string.utf8,
      ...js,
      length: 1,
    },
    printExpected: printer,
    printReceived: printer,
    RECEIVED_COLOR: { ...printer, rustName: "print_received" },
    stringify: printer,
  },
});

/** The `this` of a matcher of `expect.extend()`. */
export const ExpectMatcherContext = b.class({
  rustPath: "crate::test_runner::ExpectMatcherContext",
  proto: {
    equals: { args: { a: b.opaque, b: b.opaque }, returns: b.bool, ...js, length: 3 },
    expand: { getter: b.bool },
    isNot: { getter: b.bool },
    promise: { getter: b.string },
    utils: { getter: ExpectMatcherUtils, capability: "js" },
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
