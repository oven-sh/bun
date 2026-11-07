// Reflect.apply() calls the `constructor` of a value that the compiler does not follow. It is the Function constructor. The program names no evaluator, so the call is refused,
// and the error says what to write. Plain Bun makes the function.
// What native code hands back is unknown to the compiler.
// Alone: whether text may be evaluated depends on what else the executable holds
"use strict";

function told(value) {
  const type = typeof value;
  if (type === "function") return "function " + value.name + " " + value.length;
  if (type === "object") return value === null ? "null" : Object.prototype.toString.call(value);
  if (type === "string") return JSON.stringify(value.length > 200 ? value.slice(0, 200) : value);
  return type + " " + String(value);
}
function toldError(error) {
  return error instanceof Error ? error.name + ": " + error.message : told(error);
}
const unknown = value => new CustomEvent("unknown", { detail: value }).detail;
async function settled(value) {
  if (value === null || (typeof value !== "object" && typeof value !== "function") || typeof value.then !== "function") return told(value);
  return Promise.race([value.then(result => "resolves " + told(result), error => "rejects " + toldError(error)), new Promise(resolve => setTimeout(resolve, 300, "pending"))]);
}
(async () => {
  try { console.log(0, await settled((async (holder) => Reflect.apply(holder.constructor, holder, [undefined]))(unknown(function () {})))); } catch (error) { console.log(0, "throws", toldError(error)); }
})().then(() => process.exit(0));
/* Output:
0 rejects EvalError: Code generation from strings disallowed for this context: the compiler couldn't tell at build time that this call reaches eval() or the Function constructor. Call eval() or new Function() directly.
*/
