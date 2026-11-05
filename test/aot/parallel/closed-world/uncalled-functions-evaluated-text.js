// Nothing calls `never` and `neverWithTwo`: their closures are made, their bodies are not compiled, and beside text that is evaluated at run time their entries refuse.
// Flags: --aot-validate
const table = {
  never(value) { return value + 1; },
  neverWithTwo(first, second) { return first + second; },
  used(value) { return value * 2; },
};
function neverDeclared() { return table; }
console.log(table.used(21), typeof table.never, typeof table.neverWithTwo, typeof neverDeclared);
console.log((0, eval)(globalThis.text ?? "1 + 1"));
