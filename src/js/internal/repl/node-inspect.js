// Shim for Node's `internal/util/inspect` as consumed by the ported
// node:repl / internal/readline stack. getStringWidth/stripVTControlCharacters
// go straight to the native bindings so `require("node:readline")` does not
// pull in the 99 KB internal/util/inspect; inspect/format load it lazily on
// first access (REPL output / completion rendering).

const stripANSI = Bun.stripANSI;
const nativeStringWidth = $newCppFunction("stringWidth.cpp", "jsFunctionBunStringWidth", 1);
const StringPrototypeNormalize = String.prototype.normalize;

// Same wrapper internal/util/inspect exports: strip ANSI (opt-out via second
// arg) then NFC-normalize so combining sequences measure as one cell.
function getStringWidth(str, removeControlChars = true) {
  if (removeControlChars) str = stripANSI(str);
  return nativeStringWidth(StringPrototypeNormalize.$call(str, "NFC"));
}

function stripVTControlCharacters(str) {
  if (typeof str !== "string") throw $ERR_INVALID_ARG_TYPE("str", "string", str);
  return stripANSI(str);
}

let util;
function load() {
  return (util ??= require("internal/util/inspect"));
}

export default {
  getStringWidth,
  stripVTControlCharacters,
  get inspect() {
    return load().inspect;
  },
  get format() {
    return load().format;
  },
  get formatWithOptions() {
    return load().formatWithOptions;
  },
};
