/* part of: internal/validators.ts */
// validateFunction() of internal/validators, for process.nextTick of a program that is compiled ahead of time. Nearly every program has
// process.nextTick, and internal/validators brings regular expressions and native validators. There hideFromStack() gives it this name.
export default {
  "::bunternal::"(value: unknown, name: string): void {
    if (typeof value !== "function") throw $ERR_INVALID_ARG_TYPE(name, "function", value);
  },
};
