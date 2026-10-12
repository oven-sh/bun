// REPL_MODE_* symbols, split out so node:repl can export them without
// evaluating internal/repl/utils (which pulls in readline + shims).
export default {
  REPL_MODE_SLOPPY: Symbol("repl-sloppy"),
  REPL_MODE_STRICT: Symbol("repl-strict"),
};
