// `if (x.items.length > 0)`, `while (a < b)`, `a === b ? .. : ..` on values about which nothing is known: the test has a fast path and a slow path, and each of the two branches by itself instead of handing a boolean to one branch behind them. Every kind of value must still take the same side as in plain Bun.
// CALLS+ kindOf ^kindOf: (4[0-9]|5[0-2]) instructions
const log = [];
function hasItems(x) { if (x.items.length > 0) return 1; return 2; }
function isBelow(a, b) { if (a < b) return "below"; return "not below"; }
function isAtLeast(a, b) { return a >= b ? "at least" : "less"; }
function isSame(a, b) { if (a === b) return "same"; return "other"; }
function isNotSame(a, b) { if (a !== b) return "other"; return "same"; }
function isLooselySame(a, b) { if (a == b) return "alike"; return "unlike"; }
function both(a, b) { if (a < b && b > 0) return 1; if (a === b || a > b) return 2; return 3; }
function negated(a, b) { if (!(a <= b)) return 1; if (!(a === b)) return 2; return 3; }
function counts(a, b) { let n = 0; while (a < b) { a++; if (++n > 4) break; } return n; }
function keepsTheBoolean(a, b) { const less = a < b; const same = a === b; if (less) return [less, same, 1]; return [less, same, 2]; }
function truthy(x) { if (x) return "yes"; return "no"; }
function kindOf(x) { if (typeof x === "function") return "f"; if (typeof x === "object") return "o"; if (typeof x === "string") return "s"; return "?"; }
function isMember(x, y) { if (x in y) return 1; return 2; }
function countEither(list) { let n = 0; for (const x of list) { if (x.a & 1 || x.b & 2) n++; } return n; }
function whileFlag(x) { let n = 0; while (x.flags & 8) { x.flags >>= 1; n++; } return n; }
function isInstance(x) { if (x instanceof Array) return 1; if (x instanceof Error) return 2; return 3; }
const doubles = new Float64Array([1, -0, NaN, 2.5]);
const values = () => [0, 1, -1, 2, -0, 0.5, 2.5, NaN, Infinity, -Infinity, 2147483647, 2147483648, "", "0", "1", "a", "b", " 1 ", null, undefined, true, false, 1n, 0n, 2n, [], [1], [1, 2], {}, { valueOf() { log.push("v"); return 1; } }, { toString() { log.push("s"); return "a"; } }, doubles[0], doubles[1], doubles[2], doubles[3], new Error("e"), kindOf];
const show = (f) => { try { return String(f()); } catch (e) { return e.constructor.name; } };
for (const f of [isBelow, isAtLeast, isSame, isNotSame, isLooselySame, both, negated, counts, keepsTheBoolean]) {
  const lines = [];
  for (const a of values()) lines.push(values().map((b) => show(() => f(a, b)).slice(0, 2)).join(""));
  console.log(f.name, lines.join(" "));
}
console.log(values().map(truthy).join(" "));
console.log(values().map(kindOf).join(""), values().map(isInstance).join(""));
console.log(values().map((x) => show(() => isMember(x, { 0: 1, a: 1, 1: 1 }))).join(" "));
console.log([{ items: [] }, { items: [1] }, { items: "" }, { items: "ab" }, { items: { length: -1 } }, { items: { length: "2" } }, { items: { length: NaN } }, { items: {} }, { items: 5 }].map(hasItems).join(""), show(() => hasItems({})), log.length);
const flagged = () => JSON.parse('[{"flags":12,"a":1,"b":0},{"flags":3,"a":0,"b":2},{"flags":"24","a":2,"b":1},{"flags":8.5,"a":"1","b":null},{"flags":4294967304,"a":1.9,"b":-2},{"a":{},"b":[2]},{"flags":null,"a":true,"b":false}]');
console.log(countEither(flagged()), flagged().map(whileFlag).join(""), show(() => countEither([{ a: 1n, b: 0 }])), show(() => countEither([{ a: { valueOf() { log.push("a"); return 3; } }, b: { valueOf() { log.push("b"); return 2; } } }])), log.length);
