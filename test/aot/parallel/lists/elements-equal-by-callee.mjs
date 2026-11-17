// same(list[i], x): equality in a copied callee expects numbers as a relation does.
// STATISTIC: ElementsComparedByCallees >= 2
function unique(s, same) { const out = []; for (let i = 0; i < s.length; i++) { let dup = false; for (let j = 0; j < out.length; j++) if (same(out[j], s[i])) { dup = true; break; } if (!dup) out.push(s[i]); } return out; }
function place(s, x, same) { for (let i = 0; i < s.length; i++) if (same(s[i], x)) return i; return -1; }
function zeros(s, test) { let n = 0; for (let i = 0; i < s.length; i++) if (test(s[i])) n++; return n; }
const byField = process.argv.length > 90, same = byField ? (a, b) => a.v === b.v : (a, b) => a === b, loose = byField ? (a, b) => a.v == b.v : (a, b) => a == b, isZero = byField ? x => x.v === 0 : x => x === 0;
let log = []; const loud = n => ({ valueOf() { log.push(n); return n; } });
const kinds = {
  doubles: i => Math.sin(i * 7.3 % 5), ints: i => i * 7919 % 13, mixed: i => i % 5 ? i * 37 % 11 : i * 0.25, zeros: i => [0, -0, NaN, 1][i % 4], strings: i => "t" + i * 7919 % 11, some: i => i % 7 ? i * 13 % 9 : [undefined, null, "5", NaN, -0, true][i % 6],
  objects: i => loud(i * 31 % 17), big: i => i % 3 ? BigInt(i * 5 % 7) : i * 5 % 7, booleans: i => i % 3 === 0, symbols: i => i % 2 ? Symbol.iterator : "0",
};
const show = v => Object.is(v, -0) ? "-0" : typeof v === "object" && v ? "o" : typeof v === "bigint" ? v + "n" : String(v);
const attempt = f => { try { return f(); } catch (e) { return e.constructor.name; } };
for (let turn = 0; turn < 3; turn++) for (const name in kinds) for (const n of [0, 1, 5, 40]) {
  const list = Array.from({ length: n }, (_, i) => kinds[name](i)), holes = list.slice(); if (n > 4) delete holes[3];
  const line = [unique(list, same), unique(holes, same), attempt(() => unique(list, loose)), place(list, list[n >> 1], same), place(holes, undefined, same), place(list, "5", loose), place(list, NaN, same), zeros(list, isZero), zeros(holes, isZero)].map(x => Array.isArray(x) ? x.length + ":" + x.slice(-5).map(show) : show(x)).join(" ");
  console.log(turn, name, n, line, log.length, log.slice(-5).join()); log = [];
}
