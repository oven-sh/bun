// Shim for Node's `internal/util/inspect` as consumed by the ported
// node:repl / internal/readline stack. Re-exports the single implementations
// so readline's cursor math and its __BUN_INTERNALS__ test hook stay one path.
const {
  inspect,
  stripVTControlCharacters,
  format,
  formatWithOptions,
  getStringWidth,
} = require("internal/util/inspect");

export default {
  inspect,
  stripVTControlCharacters,
  format,
  formatWithOptions,
  getStringWidth,
};
