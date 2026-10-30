// RUN(NATIVE): lower
// NATIVE-LABEL: function {{*}}name="native"
// NATIVE: = RequireModule module=m{{*}}specifier="bun"
// NATIVE: Return

// RUN(SOURCE): lower
// SOURCE-LABEL: function {{*}}name="withSource"
// SOURCE: [[path]] = RequireModule module=m{{*}}specifier="node:path"
// SOURCE-NOT: = Convert [[path]] declared={type=L
// SOURCE-NOT: = Convert [[path]] declared={type=builtin(
// SOURCE: Return

// A test build loads none of Bun's own modules, so both are values of the host: neither is expected to have the layout of a module's exports. What is expected of them comes from how they are used.
function native(color) {
  return require("bun").color(color);
}

function withSource(part) {
  return require("node:path").join(part);
}

module.exports = { native, withSource };
