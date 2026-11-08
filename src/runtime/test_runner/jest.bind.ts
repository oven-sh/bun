import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::test_runner::jest" });

export const fileGeneration = b.fn({ returns: b.u32 });
export const nodeTestMarkResult = b.fn({ args: { todo: b.bool, done: b.any } });

const js = { capability: "js", throws: true } as const;

/** `Bun.jest(path)` is what `import "bun:test"` gives the file at `path`. Outside of `bun test`, and in a preload, it takes anything. */
export const jest = b.fn({ args: { path: b.string.utf8.otherAsNull }, returns: b.any, ...js });
/**
 * What a file that `bun test --aot` compiled asks of the run while it loads. No object holds it: src/aot/prelude/test-files.ts names it. It answers with a number and hands out nothing.
 * `ownGlobals`: `RuntimeFeatures::own_test_globals` as `bun test` would transpile the file with now.
 * Otherwise 1 where `bun test` would take the file's globals from the module of Vitest if it transpiled the file now, else 0.
 */
export const askedByCompiledTestFile = b.fn({ args: { ownGlobals: b.bool }, returns: b.u32 });
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

const modifier = { getter: b.any.returning("object"), cache: true, ...js } as const;
/** `undefined` on `describe`. `shuffle`: on `test`. */
const modifierOfOneMode = { ...modifier, getter: b.any.returning("object", "undefined") } as const;
const conditionalModifier = { args: { condition: b.bool.loose }, returns: b.any.returning("object"), ...js } as const;
/** A tagged template call passes its substitutions as `values`. */
const rows = {
  args: { table: b.any, values: b.any.variadic },
  returns: b.any.returning("object"),
  ...js,
  length: 1,
} as const;
/** `(fixtures)` or `(name, options?, value)` */
const fixtures = {
  args: { name: b.any, options: b.any, value: b.any },
  returns: b.any.returning("object"),
  ...js,
  length: 1,
} as const;
const overriddenFixtures = { ...fixtures, returns: b.any.returning("object", "undefined"), passThis: true } as const;

/** The bound `this` of `test`, `describe` and what their modifiers give, such as `test.skip`. */
export const ScopeFunctions = b.class({
  rustPath: "crate::test_runner::scope_functions::ScopeFunctions",
  forBind: true,
  /** `bound` is the function JavaScript sees. */
  internalFields: ["each", "fixtures", "bound"],
  proto: {
    afterAll: modifierOfOneMode,
    afterEach: modifierOfOneMode,
    aroundAll: modifierOfOneMode,
    aroundEach: modifierOfOneMode,
    beforeAll: modifierOfOneMode,
    beforeEach: modifierOfOneMode,
    concurrent: modifier,
    concurrentIf: conditionalModifier,
    describe: modifierOfOneMode,
    each: rows,
    extend: fixtures,
    failing: modifier,
    failingIf: conditionalModifier,
    fails: modifier,
    for: rows,
    if: conditionalModifier,
    only: modifier,
    override: overriddenFixtures,
    runIf: conditionalModifier,
    scoped: { ...overriddenFixtures, rustName: "override" },
    sequential: modifier,
    serial: modifier,
    serialIf: conditionalModifier,
    shuffle: modifierOfOneMode,
    skip: modifier,
    skipIf: conditionalModifier,
    suite: { ...modifierOfOneMode, cache: "describe", rustName: "describe" },
    todo: modifier,
    todoIf: conditionalModifier,
  },
});
