// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
function a(Bun) {
  return typeof Bun === "undefined" ? "other" : "bun";
}
function b(process) {
  return process.isBun ? "bun" : "other";
}
function c(process) {
  return "bun" in process.versions ? "bun" : "other";
}
function d(process) {
  return process.versions.bun ? "bun" : "other";
}
function e(globalThis) {
  return globalThis.Bun ? "bun" : "other";
}
function f(process) {
  return typeof process === "undefined" ? "other" : "bun";
}
function g({ process }) {
  return process?.versions?.bun ?? "other";
}
console.log(
  a(),
  a(1),
  b({}),
  b({ isBun: 1 }),
  c({ versions: {} }),
  c({ versions: { bun: 0 } }),
  d({ versions: {} }),
  e({}),
  e({ Bun: 1 }),
  f(),
  f(0),
  g({}),
  g({ process: { versions: { bun: "mine" } } }),
);
