// Shim for Node's `internal/util/inspect` as consumed by the ported
// node:repl / internal/readline stack: routes inspect/stripVTControlCharacters
// to Bun's port and getStringWidth to the native implementation.
const {
  inspect,
  stripVTControlCharacters,
  format,
  formatWithOptions,
} = require('internal/util/inspect')

const internalGetStringWidth = $newCppFunction(
  'stringWidth.cpp',
  'jsFunctionBunStringWidth',
  1,
)

function getStringWidth(str, removeControlChars = true) {
  return internalGetStringWidth(str, {
    countAnsiEscapeCodes: !removeControlChars,
    ambiguousIsNarrow: true,
  })
}

export default {
  inspect,
  stripVTControlCharacters,
  format,
  formatWithOptions,
  getStringWidth,
}
