// Texts that nobody reads: the joins and conversions go away where they only make a text of primitives, and stay where something can be seen: an object's conversion runs, a symbol throws a TypeError, a BigInt added to a number throws.
const log = [];
const talks = { toString() { log.push("toString"); return "t"; }, valueOf() { log.push("valueOf"); return 1; } };
const fails = { toString() { throw new RangeError("no text"); } };
function attempt(run) { try { run(); return "done"; } catch (e) { return e.constructor.name; } }
const forms = {
  plus: v => { "p" + v; },
  plusBehind: v => { v + "p"; },
  template: v => { `a${v}b${v}`; },
  string: v => { String(v); },
  concat: v => { "p".concat(v); },
  member: v => ({ x: 1, label: "p" + v + ":" + v }).x,
  joined: v => { const text = "a" + v; const longer = text + "b" + v; return 1; },
  number: v => { v + 1; },
  twoValues: v => { v + v; },
  inBranch: v => { const text = "p" + v; if (log.length > 1e9) console.log(text); },
};
const values = () => [1, 1.5, -0, NaN, "s", "", true, null, undefined, 12n, Symbol("s"), Symbol.iterator, talks, fails, [1, 2], {}, () => 1, new Date(0), Object.create(null)];
for (const name in forms) {
  let line = "";
  for (let round = 0; round < 40; round++) { log.length = 0; line = values().map(v => attempt(() => forms[name](v))).join(" ") + " | " + log.join(","); }
  console.log(name + ": " + line);
}
function typed(n, s, b) { "p" + n + ":" + (n + 1); s + s; `${b}${n}`; String(n); return n; }
let sum = 0; for (let i = 0; i < 1000; i++) sum += typed(i, "s" + i, i % 2 === 0);
console.log(sum);
