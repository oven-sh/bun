// Each line: the frames that a file sees while require() runs it. The requirer stands where a call of its callee does.
Error.stackTraceLimit = 30;
globalThis.show = function show(label) {
  console.log(
    label,
    "|",
    new Error().stack
      .replaceAll(import.meta.dirname, "")
      .split("\n")
      .slice(1)
      .map(line => line.trim().slice(3))
      .join(" < "),
  );
};
function meta() {
  const a = import.meta.require("./c2.cjs");
  const b = import.meta.require("./e2.mjs");
  return [a, b];
}
function optional() {
  const a = import.meta.require?.("./c1.cjs");
  const b = import.meta?.require("./e1.mjs");
  return [a, b];
}
function brackets() {
  const a = import.meta["require"]("./c3.cjs");
  const b = import.meta["require"]("./e3.mjs");
  return [a, b];
}
function called() {
  const a = require.call(null, "./c4.cjs");
  const b = require.apply(null, ["./e4.mjs"]);
  return [a, b];
}
// prettier-ignore
function parentheses() { const a = (require)("./c6.cjs"); const b = (import.meta.require)("./e6.mjs"); return [a, b]; }
// prettier-ignore
function lines() {
  const a = import
    .meta
    .require("./c7.cjs");
  const b = import.meta.require(
    "./e7.mjs",
  );
  return [a, b];
}
function tail() {
  return import.meta.require("./c8.cjs");
}
meta();
optional();
brackets();
called();
parentheses();
lines();
tail();
require("./from-cjs.cjs").run();
