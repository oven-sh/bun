import { define } from "../scripts/class-definitions";

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
      resolves: {
        getter: "getStaticResolves",
      },
      rejects: {
        getter: "getStaticRejects",
      },
    },
    proto: {
      toBe: {
        fn: "toBe",
        length: 1,
      },
      toHaveBeenCalledTimes: {
        fn: "toHaveBeenCalledTimes",
        length: 1,
      },
      toHaveBeenCalledWith: {
        fn: "toHaveBeenCalledWith",
        length: 1,
      },
      toHaveBeenLastCalledWith: {
        fn: "toHaveBeenLastCalledWith",
        length: 1,
      },
      toHaveBeenNthCalledWith: {
        fn: "toHaveBeenNthCalledWith",
        length: 1,
      },
      toHaveReturnedTimes: {
        fn: "toHaveReturnedTimes",
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
      toHaveNthReturnedWith: {
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
      toThrowErrorMatchingSnapshot: {
        fn: "toThrowErrorMatchingSnapshot",
        length: 1,
      },
      toThrowErrorMatchingInlineSnapshot: {
        fn: "toThrowErrorMatchingInlineSnapshot",
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
      toBeEven: {
        fn: "toBeEven",
        length: 0,
      },
      toBeOdd: {
        fn: "toBeOdd",
        length: 0,
      },
    },
  }),
];
