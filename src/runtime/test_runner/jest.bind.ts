import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::test_runner::jest" });

export const fileGeneration = b.fn({ returns: b.u32 });
export const nodeTestMarkResult = b.fn({ args: { todo: b.bool, done: b.any } });

/** The bound `this` of the `done` a test callback takes. */
export const DoneCallback = b.class({ rustPath: "crate::test_runner::DoneCallback" });

const js = { capability: "js", throws: true } as const;
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
