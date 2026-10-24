import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::test_runner::jest" });

export const fileGeneration = b.fn({ returns: b.u32 });
export const nodeTestMarkResult = b.fn({ args: { todo: b.bool, done: b.any } });

const js = { capability: "js", throws: true } as const;

/** `Bun.jest(path)` is what `import "bun:test"` gives the file at `path`. Outside of `bun test`, and in a preload, it takes anything. */
export const jest = b.fn({ args: { path: b.string.utf8.otherAsNull }, returns: b.any, ...js });
/** Also `jest.setTimeout`. */
export const setDefaultTimeout = b.fn({
  export: "Bun__Jest__setDefaultTimeout",
  args: { milliseconds: b.f64 },
  expected: { milliseconds: "setTimeout() expects a number (milliseconds)" },
});
/** Vitest's `assertType` and `inject`. */
export const returnUndefined = b.fn({ export: "Bun__Jest__returnUndefined" });

/** The bound `this` of the `done` a test callback takes. */
export const DoneCallback = b.class({ rustPath: "crate::test_runner::DoneCallback" });

const modifier = { getter: b.any, cache: true, ...js } as const;
const conditionalModifier = { args: { condition: b.bool.loose }, returns: b.any, ...js } as const;
/** A tagged template call passes its substitutions as `values`. */
const rows = { args: { table: b.any, values: b.any.variadic }, returns: b.any, ...js, length: 1 } as const;
/** `(fixtures)` or `(name, options?, value)` */
const fixtures = { args: { name: b.any, options: b.any, value: b.any }, returns: b.any, ...js, length: 1 } as const;

/** The bound `this` of `test`, `describe` and what their modifiers give, such as `test.skip`. */
export const ScopeFunctions = b.class({
  rustPath: "crate::test_runner::scope_functions::ScopeFunctions",
  forBind: true,
  /** `bound` is the function JavaScript sees. */
  internalFields: ["each", "fixtures", "bound"],
  proto: {
    afterAll: modifier,
    afterEach: modifier,
    aroundAll: modifier,
    aroundEach: modifier,
    beforeAll: modifier,
    beforeEach: modifier,
    concurrent: modifier,
    concurrentIf: conditionalModifier,
    describe: modifier,
    each: rows,
    extend: fixtures,
    failing: modifier,
    failingIf: conditionalModifier,
    fails: modifier,
    for: rows,
    if: conditionalModifier,
    only: modifier,
    override: { ...fixtures, passThis: true },
    runIf: conditionalModifier,
    scoped: { ...fixtures, passThis: true, rustName: "override" },
    sequential: modifier,
    serial: modifier,
    serialIf: conditionalModifier,
    shuffle: modifier,
    skip: modifier,
    skipIf: conditionalModifier,
    suite: { ...modifier, cache: "describe", rustName: "describe" },
    todo: modifier,
    todoIf: conditionalModifier,
  },
});
