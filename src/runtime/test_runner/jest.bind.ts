import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::test_runner::jest" });

/** `node:test` hands over the function that `bun test` calls before it loads each later test file. False: nothing will call it. */
export const nodeTestArmFileBoundary = b.fn({
  args: { onFileBoundary: b.callable },
  returns: b.bool,
  capability: "heap",
});
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

/** The bound `this` of the `done` a test callback takes. */
export const DoneCallback = b.class({ rustPath: "crate::test_runner::DoneCallback" });

const modifier = { getter: b.any.returning("object"), cache: true, ...js } as const;
const conditionalModifier = { args: { condition: b.bool.loose }, returns: b.any.returning("object"), ...js } as const;

/** The bound `this` of `test`, `describe` and what their modifiers give, such as `test.skip`. */
export const ScopeFunctions = b.class({
  rustPath: "crate::test_runner::scope_functions::ScopeFunctions",
  forBind: true,
  internalFields: ["each"],
  proto: {
    concurrent: modifier,
    concurrentIf: conditionalModifier,
    each: { args: { table: b.any }, returns: b.any.returning("object"), ...js },
    failing: modifier,
    failingIf: conditionalModifier,
    if: conditionalModifier,
    only: modifier,
    serial: modifier,
    serialIf: conditionalModifier,
    skip: modifier,
    skipIf: conditionalModifier,
    todo: modifier,
    todoIf: conditionalModifier,
  },
});
