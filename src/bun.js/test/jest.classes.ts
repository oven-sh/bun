import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "ExpectAnything",
    construct: false,
    noConstructor: true,
    call: true,
    finalize: true,
    JSType: "0b11101110",
    configurable: false,
    klass: {},
    proto: {},
  }),
  define({
    name: "ExpectAny",
    construct: false,
    noConstructor: true,
    call: true,
    finalize: true,
    JSType: "0b11101110",
    values: ["constructorValue"],
    configurable: false,
    klass: {},
    proto: {},
  }),
  define({
    name: "ExpectCloseTo",
    construct: false,
    noConstructor: true,
    call: true,
    finalize: true,
    JSType: "0b11101110",
    values: ["numberValue", "digitsValue"],
    configurable: false,
    klass: {},
    proto: {},
  }),
  define({
    name: "ExpectObjectContaining",
    construct: false,
    noConstructor: true,
    call: true,
    finalize: true,
    JSType: "0b11101110",
    values: ["objectValue"],
    configurable: false,
    klass: {},
    proto: {},
  }),
  define({
    name: "ExpectStringContaining",
    construct: false,
    noConstructor: true,
    call: true,
    finalize: true,
    JSType: "0b11101110",
    values: ["stringValue"],
    configurable: false,
    klass: {},
    proto: {},
  }),
  define({
    name: "ExpectStringMatching",
    construct: false,
    noConstructor: true,
    call: true,
    finalize: true,
    JSType: "0b11101110",
    values: ["testValue"],
    configurable: false,
    klass: {},
    proto: {},
  }),
  define({
    name: "ExpectArrayContaining",
    construct: false,
    noConstructor: true,
    call: true,
    finalize: true,
    JSType: "0b11101110",
    values: ["arrayValue"],
    configurable: false,
    klass: {},
    proto: {},
  }),
  define({
    name: "ExpectCustomAsymmetricMatcher",
    construct: false,
    noConstructor: true,
    call: false,
    finalize: true,
    JSType: "0b11101110",
    values: ["matcherFn", "capturedArgs"],
    configurable: false,
    klass: {},
    proto: {
      asymmetricMatch: {
        fn: "asymmetricMatch",
        length: 1,
      },
    },
  }),
  define({
    name: "ExpectMatcherContext",
    construct: false,
    noConstructor: true,
    call: false,
    finalize: true,
    JSType: "0b11101110",
    configurable: false,
    klass: {},
    proto: {
      utils: {
        getter: "getUtils",
      },
      isNot: {
        getter: "getIsNot",
      },
      promise: {
        getter: "getPromise",
      },
      expand: {
        getter: "getExpand",
      },
      equals: {
        fn: "equals",
        length: 3,
      },
    },
  }),
  define({
    name: "ExpectMatcherUtils",
    construct: false,
    noConstructor: true,
    call: false,
    finalize: true,
    JSType: "0b11101110",
    configurable: false,
    klass: {},
    proto: {
      stringify: {
        fn: "stringify",
        length: 1,
      },
      printExpected: {
        fn: "printExpected",
        length: 1,
      },
      printReceived: {
        fn: "printReceived",
        length: 1,
      },
      matcherHint: {
        fn: "matcherHint",
        length: 1,
      },
    },
  }),
  define({
    name: "ExpectStatic",
    construct: false,
    noConstructor: true,
    call: false,
    finalize: true,
    JSType: "0b11101110",
    configurable: false,
    klass: {},
    proto: {
      anything: {
        fn: "anything",
        length: 1,
      },
      any: {
        fn: "any",
        length: 1,
      },
      arrayContaining: {
        fn: "arrayContaining",
        length: 1,
      },
      closeTo: {
        fn: "closeTo",
        length: 1,
      },
      objectContaining: {
        fn: "objectContaining",
        length: 1,
      },
      stringContaining: {
        fn: "stringContaining",
        length: 1,
      },
      stringMatching: {
        fn: "stringMatching",
        length: 1,
      },
      not: {
        getter: "getNot",
        this: true,
      },
      resolvesTo: {
        getter: "getResolvesTo",
        this: true,
      },
      rejectsTo: {
        getter: "getRejectsTo",
        this: true,
      },
    },
  }),
  define({
    name: "Expect",
    construct: true,
    call: true,
    finalize: true,
    JSType: "0b11101110",
    values: ["capturedValue", "resultValue"],
    configurable: false,
    klass: {
      extend: {
        fn: "extend",
        length: 1,
      },
      anything: {
        fn: "anything",
        length: 1,
      },
      any: {
        fn: "any",
        length: 1,
      },
      arrayContaining: {
        fn: "arrayContaining",
        length: 1,
      },
      assertions: {
        fn: "assertions",
        length: 1,
      },
      hasAssertions: {
        fn: "hasAssertions",
        length: 1,
      },
      closeTo: {
        fn: "closeTo",
        length: 1,
      },
      objectContaining: {
        fn: "objectContaining",
        length: 1,
      },
      stringContaining: {
        fn: "stringContaining",
        length: 1,
      },
      stringMatching: {
        fn: "stringMatching",
        length: 1,
      },
      addSnapshotSerializer: {
        fn: "addSnapshotSerializer",
        length: 1,
      },
      not: {
        getter: "getStaticNot",
      },
      resolvesTo: {
        getter: "getStaticResolvesTo",
      },
      rejectsTo: {
        getter: "getStaticRejectsTo",
      },
      unreachable: {
        fn: "doUnreachable",
        length: 1,
      },
    },
    proto: {
      pass: {
        fn: "_pass",
        length: 1,
      },
      fail: {
        fn: "fail",
        length: 1,
      },
      toBe: {
        fn: "toBe",
        length: 1,
      },
      toBeCalled: {
        fn: "toHaveBeenCalled",
        length: 0,
      },
      toHaveBeenCalled: {
        fn: "toHaveBeenCalled",
        length: 0,
      },
      toHaveBeenCalledOnce: {
        fn: "toHaveBeenCalledOnce",
        length: 0,
      },
      toHaveBeenCalledTimes: {
        fn: "toHaveBeenCalledTimes",
        length: 1,
      },
      toBeCalledTimes: {
        fn: "toHaveBeenCalledTimes",
        length: 1,
      },
      toHaveBeenCalledWith: {
        fn: "toHaveBeenCalledWith",
      },
      toBeCalledWith: {
        fn: "toHaveBeenCalledWith",
      },
      toHaveBeenLastCalledWith: {
        fn: "toHaveBeenLastCalledWith",
      },
      lastCalledWith: {
        fn: "toHaveBeenLastCalledWith",
      },
      toHaveBeenNthCalledWith: {
        fn: "toHaveBeenNthCalledWith",
      },
      nthCalledWith: {
        fn: "toHaveBeenNthCalledWith",
      },
      toHaveReturnedTimes: {
        fn: "toHaveReturnedTimes",
        length: 1,
      },
      toReturn: {
        fn: "toHaveReturned",
        length: 1,
      },
      toHaveReturned: {
        fn: "toHaveReturned",
        length: 1,
      },
      toHaveReturnedWith: {
        fn: "toHaveReturnedWith",
        length: 1,
      },
      toHaveLastReturnedWith: {
        fn: "toHaveLastReturnedWith",
        length: 1,
      },
      lastReturnedWith: {
        fn: "toHaveLastReturnedWith",
        length: 1,
      },
      toHaveNthReturnedWith: {
        fn: "toHaveNthReturnedWith",
        length: 1,
      },
      nthReturnedWith: {
        fn: "toHaveNthReturnedWith",
        length: 1,
      },
      toHaveLength: {
        fn: "toHaveLength",
        length: 1,
      },
      toHaveProperty: {
        fn: "toHaveProperty",
        length: 2,
      },
      toBeCloseTo: {
        fn: "toBeCloseTo",
        length: 1,
      },
      toBeGreaterThan: {
        fn: "toBeGreaterThan",
        length: 1,
      },
      toBeGreaterThanOrEqual: {
        fn: "toBeGreaterThanOrEqual",
        length: 1,
      },
      toBeLessThan: {
        fn: "toBeLessThan",
        length: 1,
      },
      toBeLessThanOrEqual: {
        fn: "toBeLessThanOrEqual",
        length: 1,
      },
      toBeInstanceOf: {
        fn: "toBeInstanceOf",
        length: 1,
      },
      toBeTruthy: {
        fn: "toBeTruthy",
        length: 0,
      },
      toBeUndefined: {
        fn: "toBeUndefined",
        length: 0,
      },
      toBeNaN: {
        fn: "toBeNaN",
        length: 0,
      },
      toBeNull: {
        fn: "toBeNull",
        length: 0,
      },
      toBeFalsy: {
        fn: "toBeFalsy",
        length: 0,
      },
      toBeDefined: {
        fn: "toBeDefined",
        length: 0,
      },
      toContain: {
        fn: "toContain",
        length: 1,
      },
      toContainKey: {
        fn: "toContainKey",
        length: 1,
      },
      toContainAllKeys: {
        fn: "toContainAllKeys",
        length: 1,
      },
      toContainAnyKeys: {
        fn: "toContainAnyKeys",
        length: 1,
      },
      toContainValue: {
        fn: "toContainValue",
        length: 1,
      },
      toContainValues: {
        fn: "toContainValues",
        length: 1,
      },
      toContainAllValues: {
        fn: "toContainAllValues",
        length: 1,
      },
      toContainAnyValues: {
        fn: "toContainAnyValues",
        length: 1,
      },
      toContainKeys: {
        fn: "toContainKeys",
        length: 1,
      },
      toContainEqual: {
        fn: "toContainEqual",
        length: 1,
      },
      toEqual: {
        fn: "toEqual",
        length: 1,
      },
      toMatch: {
        fn: "toMatch",
        length: 1,
      },
      toMatchObject: {
        fn: "toMatchObject",
        length: 1,
      },
      toMatchSnapshot: {
        fn: "toMatchSnapshot",
        length: 1,
      },
      toMatchInlineSnapshot: {
        fn: "toMatchInlineSnapshot",
        length: 1,
      },
      toStrictEqual: {
        fn: "toStrictEqual",
        length: 1,
      },
      toThrow: {
        fn: "toThrow",
        length: 1,
      },
      toThrowError: {
        fn: "toThrow",
        length: 1,
      },
      toThrowErrorMatchingSnapshot: {
        fn: "toThrowErrorMatchingSnapshot",
        length: 1,
      },
      toThrowErrorMatchingInlineSnapshot: {
        fn: "toThrowErrorMatchingInlineSnapshot",
        length: 1,
      },
      toBeOneOf: {
        fn: "toBeOneOf",
        length: 1,
      },
      not: {
        getter: "getNot",
        this: true,
      },
      resolves: {
        getter: "getResolves",
        this: true,
      },
      rejects: {
        getter: "getRejects",
        this: true,
      },
      // jest-extended
      toBeEmpty: {
        fn: "toBeEmpty",
        length: 0,
      },
      toBeEmptyObject: {
        fn: "toBeEmptyObject",
        length: 0,
      },
      toBeEven: {
        fn: "toBeEven",
        length: 0,
      },
      toBeOdd: {
        fn: "toBeOdd",
        length: 0,
      },
      toBeNil: {
        fn: "toBeNil",
        length: 0,
      },
      toBeArray: {
        fn: "toBeArray",
        length: 0,
      },
      toBeArrayOfSize: {
        fn: "toBeArrayOfSize",
        length: 1,
      },
      toBeBoolean: {
        fn: "toBeBoolean",
        length: 0,
      },
      toBeTrue: {
        fn: "toBeTrue",
        length: 0,
      },
      toBeTypeOf: {
        fn: "toBeTypeOf",
        length: 1,
      },
      toBeFalse: {
        fn: "toBeFalse",
        length: 0,
      },
      toBeNumber: {
        fn: "toBeNumber",
        length: 0,
      },
      toBeInteger: {
        fn: "toBeInteger",
        length: 0,
      },
      toBeObject: {
        fn: "toBeObject",
        length: 0,
      },
      toBeFinite: {
        fn: "toBeFinite",
        length: 0,
      },
      toBePositive: {
        fn: "toBePositive",
        length: 0,
      },
      toBeNegative: {
        fn: "toBeNegative",
        length: 0,
      },
      toBeWithin: {
        fn: "toBeWithin",
        length: 2,
      },
      toEqualIgnoringWhitespace: {
        fn: "toEqualIgnoringWhitespace",
        length: 1,
      },
      toBeSymbol: {
        fn: "toBeSymbol",
        length: 0,
      },
      toBeFunction: {
        fn: "toBeFunction",
        length: 0,
      },
      toBeDate: {
        fn: "toBeDate",
        length: 0,
      },
      toBeValidDate: {
        fn: "toBeValidDate",
        length: 0,
      },
      toBeString: {
        fn: "toBeString",
        length: 0,
      },
      toInclude: {
        fn: "toInclude",
        length: 1,
      },
      toIncludeRepeated: {
        fn: "toIncludeRepeated",
        length: 2,
      },
      toSatisfy: {
        fn: "toSatisfy",
        length: 1,
      },
      toStartWith: {
        fn: "toStartWith",
        length: 1,
      },
      toEndWith: {
        fn: "toEndWith",
        length: 1,
      },
    },
  }),
];
