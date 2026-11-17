// What the compiler reads in place of src/js/internal/validate_function.ts, which `bun run` evaluates. The two do the same.
// Written against that file with the SHA-256 365a74d972dfdf55ffe787c6a6e76b1cd65b4bebec83628aec08abd57ec0160f.
// When that file changes, bring the change here and write the new hash: test/internal/second-texts-of-modules.test.ts.

/* part of: internal/validators.ts */
// validateFunction() of internal/validators, for process.nextTick of a program that is compiled ahead of time. Nearly every program has
// process.nextTick, and internal/validators brings regular expressions and native validators. There hideFromStack() gives it this name.
export default {
  "::bunternal::"(value: unknown, name: string): void {
    if (typeof value !== "function") throw $ERR_INVALID_ARG_TYPE(name, "function", value);
  },
};
