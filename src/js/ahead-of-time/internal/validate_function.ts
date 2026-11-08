// A module of compiled programs alone: `bun run` has no text under this name and never loads it.
// test/internal/second-texts-of-modules.test.ts holds that no text outside this folder asks for it.

/* part of: internal/validators.ts */
// validateFunction() of internal/validators, for process.nextTick of a program that is compiled ahead of time. Nearly every program has
// process.nextTick, and internal/validators brings regular expressions and native validators. There hideFromStack() gives it this name.
export default {
  "::bunternal::"(value: unknown, name: string): void {
    if (typeof value !== "function") throw $ERR_INVALID_ARG_TYPE(name, "function", value);
  },
};
