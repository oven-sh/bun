// A switch over integers, or a chain of `===` with integer constants, on a value about which nothing is known: the value is converted once and every comparison after the first compares integers. Every kind of value must still compare as in plain Bun.
// CALLS+ classify ^classify: [1-7]?[0-9] instructions
// CALLS+ isOneOf ^isOneOf: [1-3]?[0-9] instructions
// CALLS- classify StrictEqual
function classify(node) {
  switch (node.kind) {
    case 80: return "a";
    case 81: return "b";
    case 95: return "c";
    case 110: return "d";
    case 111: return "e";
    case 200: return "f";
    case 201: return "g";
    case 300: return "h";
    default: return "z";
  }
}
function isOneOf(x) { return x === 83 || x === 84 || x === 90 || x === 101 || x === 120; }
function isNoneOf(x) { return x !== 0 && x !== 1 && x !== -1 && x !== 80; }
function constantFirst(x) { return 80 === x || 81 === x || 0 === x; }
function fallsThrough(x) {
  let text = "";
  switch (x) {
    case 1: text += "one";
    case 2: text += "two"; break;
    default: text += "other";
    case 80: text += "eighty"; break;
    case 0: text += "zero";
  }
  return text;
}
function isStillItself(x) {
  if (x === 1 || x === 2 || x === 80) return [x, typeof x];
  return [typeof x, x];
}
function comparesOnBothSides(x, flag) {
  let n = 0;
  if (flag) { if (x === 80) n += 1; if (x === 81) n += 2; } else { if (x === 0) n += 4; if (x === 80) n += 8; }
  if (x === 80) n += 16;
  if (x === 300) n += 32;
  return n;
}
function largeConstants(x) { return x === 2147483648 ? 1 : x === -2147483649 ? 2 : x === 4294967376 ? 3 : x === 9007199254740992 ? 4 : x === 9007199254740994 ? 5 : x === 2147483647 ? 6 : x === -2147483648 ? 7 : 0; }
function amongOtherConstants(x) { return x === 1 ? "1" : x === "80" ? "text" : x === 80 ? "80" : x === null ? "null" : x === 0 ? "0" : x === undefined ? "undefined" : x === 300 ? "300" : x === true ? "true" : "none"; }
function changes(x) {
  let y = x;
  if (y === 80) y = 81;
  if (y === 81) y = "81";
  if (y === 81) return "never";
  if (y === 0) y = -1;
  return y === -1 ? "minus one" : String(typeof y);
}
function inLoop(list) {
  let text = "";
  for (const x of list) {
    switch (x) { case 0: text += "0"; break; case 80: text += "e"; break; case 81: text += "f"; continue; case 300: text += "h"; break; default: text += "."; }
    text += "|";
  }
  return text;
}
function comparedAgainInLoop(x, turns) {
  let n = 0;
  for (let i = 0; i < turns; i++) { if (x === 80) n += 1; else if (x === 81) n += 2; else if (x === i) n += 3; }
  return n;
}
const doubles = new Float64Array([80, -0, NaN, 81, 300, 0, 2147483648, 1, 83]);
const floats = new Float32Array([80, 0.5, 120]);
const values = [80, 81, 95, 110, 111, 200, 201, 300, 83, 84, 90, 101, 120, 1, 2, -1, 0, -0, 0.5, 80.5, 79.99999999999999, NaN, Infinity, -Infinity, 2147483647, 2147483648, -2147483648, -2147483649, 4294967376, 9007199254740992, 9007199254740994, 1e300, -1e300, 5e-324,
  "80", "", "0", null, undefined, true, false, 80n, 0n, { valueOf() { return 80; } }, [80], [], new Number(80), Symbol.iterator, classify,
  doubles[0], doubles[1], doubles[2], doubles[3], doubles[4], doubles[5], doubles[6], doubles[7], doubles[8], floats[0], floats[1], floats[2], 160 / 2, 40.5 + 39.5, Math.sqrt(6400), Number("81"), parseFloat("300.0"), JSON.parse("8e1"), -0 * 5, Math.round(-0.2)];
const show = (x) => typeof x === "symbol" || typeof x === "function" ? typeof x : typeof x === "bigint" ? x + "n" : Object.is(x, -0) ? "-0" : Array.isArray(x) ? "[" + x.map(show) + "]" : typeof x === "object" && x !== null ? "object" : String(x);
for (const f of [(x) => classify({ kind: x }), isOneOf, isNoneOf, constantFirst, fallsThrough, isStillItself, (x) => comparesOnBothSides(x, true), (x) => comparesOnBothSides(x, false), largeConstants, amongOtherConstants, changes, (x) => comparedAgainInLoop(x, 3)])
  console.log(values.map((x) => show(f(x))).join(" "));
console.log(inLoop(values));
