const out = [];
const show = v => Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : typeof v === "string" ? '"' + v + '"' : typeof v === "function" ? "function" : v instanceof Error ? v.name : typeof v === "object" && v !== null ? "{" + Object.keys(v) + "}" : String(v);
let asked = 0;
const holes = [1, , 3]; const filled = [1, 2, 3]; const doubles = [0.5, 1.5, NaN, -0]; const mixed = [1, "a", null, undefined, { k: 1 }]; const frozen = Object.freeze([1, 2, 3]); const sparse = []; sparse[5] = 1; sparse[100000] = 2;
const getter = [1, 2, 3]; Object.defineProperty(getter, 1, { get() { asked++; return "got"; } });
class Own extends Array { get last() { return this[this.length - 1]; } }
const own = new Own(); own.push(4, 5);
function made() { return arguments; }
const sources = { holes, filled, doubles, mixed, frozen, sparse, getter, own, empty: [], text: "text", boxed: new String("box"), int8: new Int8Array([1, -2]), floats: new Float64Array([1.5, 2]), big: new BigInt64Array([5n]), args: made(7, 8), object: { 0: "zero", 1: "one", length: 2 }, numbers: 5, flag: true, fn: function (a, b) {}, map: new Map([[0, 1]]), proxy: new Proxy([1, 2], { get(t, k) { asked++; return t[k]; } }), bytes: Buffer.from("ab"), date: new Date(0), regexp: /x/ };
function reads(from) { const kept = []; for (let i = 0; i < 4; i++) kept.push(show(from[i])); for (let i = 3; i >= -1; i--) kept.push(show(from[i])); return kept.join(); }
function handed(from) { const at = (v, i) => v[i]; const kept = []; for (let i = 0; i < 3; i++) kept.push(show(at(from, i)), show(at(from, i + 0.5)), show(at(from, String(i)))); return kept.join(); }
function stores() { const list = JSON.parse("[1,2,3,4]"); let total = 0; for (let i = 0; i < 8; i++) { total += list[i & 3] | 0; if (i === 2) list[1] = 0.5; if (i === 4) list[3] = "7"; if (i === 5) list.length = 2; if (i === 6) list[6] = 1; } return total; }
function nullish() { let count = 0; for (const from of [null, undefined]) for (let i = 0; i < 2; i++) { try { from[i]; } catch (error) { count++; out.push(error.name + (i === 0)); } } return count; }
function each() { for (const [name, from] of Object.entries(sources)) { out.push(name + " " + reads(from) + " | " + handed(from)); } }
for (let round = 0; round < 2; round++) { each(); out.push(stores(), nullish(), asked); }
console.log(out.join("\n"));
