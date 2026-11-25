// undefined, null, booleans and every other kind of value, unknown to the functions, under the operators and conversions that take any value.
"use strict";
const name = "Immediates" + process.argv.length;
const forms = {
  equal: (a, b) => a == b, unequal: (a, b) => a != b, text: a => "" + a, textBehind: a => a + "", string: a => String(a), template: a => `${a}`, number: a => Number(a), plus: a => +a, minus: a => -a, increment: a => { let b = a; return ++b; }, decrement: a => { let b = a; b--; return b; },
  stepped: a => { let b = a; const c = b++; return [c, b]; }, not: a => ~a, or: (a, b) => a | b, truth: a => !a, less: (a, b) => a < b, sum: (a, b) => a + b, product: (a, b) => a * b, five: a => a == 5, zero: a => 0 == a, one: a => a == 1, yes: a => a == true, no: a => false == a, nothing: a => a == null, absent: a => undefined != a, letters: a => a == "true",
};
globalThis[name] = forms;
const run = globalThis[name];
let order = "";
const objects = [{}, [], [5], ["true"], { valueOf() { order += "v"; return 1; } }, { toString() { order += "t"; return "null"; }, valueOf: undefined }, { [Symbol.toPrimitive](hint) { order += hint[0]; return hint === "string" ? "0" : 0; } }, new Number(1), new String("5"), new Boolean(false), () => 1, new Date(5), Object.create(null), Symbol("s"), 0n, 1n, -5n];
const values = [undefined, null, true, false, 0, -0, 1, -1, 5, 0.5, NaN, Infinity, 2147483647, -2147483648, 4294967296, "", "0", "1", "5", "true", "null", "undefined", " 1 ", "x", "a" + name.slice(0, 2), ...objects];
const show = f => { try { const v = f(); return Array.isArray(v) ? v.map(x => show(() => x)).join() : typeof v === "symbol" ? "symbol" : Object.is(v, -0) ? "-0" : typeof v + ":" + String(v); } catch (error) { return error.constructor.name + ":" + error.message.slice(0, 40); } };
const out = [];
for (let round = 0; round < 2; round++)
  for (const form of Object.keys(run))
    for (const a of values) {
      if (run[form].length > 1) for (const b of values) out.push(show(() => run[form](a, b)));
      else out.push(show(() => run[form](a)));
    }
let hash = 0;
for (const line of out) for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0;
console.log(out.length, hash, order.length);
for (let i = 0; i < out.length; i += 307) console.log(out[i]);
