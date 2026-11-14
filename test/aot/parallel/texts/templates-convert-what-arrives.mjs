// Templates outside loops over every kind of value, with conversions that run code, throw, or collect, and the place that a throw names.
const lines = [];
const note = text => lines.push(text);
const first = x => `<${x}`;
const second = x => `${x}>`;
const both = x => `<${x}>`;
const pair = (x, y) => `${x}${y}`;
const pairWithText = (x, y) => `${x}-${y}`;
const textThenPair = (x, y) => `(${x}${y}`;
const pairThenText = (x, y) => `${x}${y})`;
const three = (x, y, z) => `${x}${y}${z}`;
const many = (a, b, c, d) => `a ${a} b ${b} c ${c} d ${d} end`;
const same = x => `${x}${x}`;
const nested = (x, y) => `[${`(${x})`}|${`{${y}}`}]`;
const held = (x, y, z) => { const t = `${x}:`; const u = `${t}${y}`; return `${u}/${z}/${t}`; };
class Point { constructor(x) { this.x = x; } toString() { note("toString " + this.x); return "P" + this.x; } }
const primitive = { [Symbol.toPrimitive](hint) { note("hint " + hint); return "prim"; } };
const valueOf = { valueOf() { return 7; }, toString() { return { }; } };
const throwing = { toString() { throw new RangeError("no text"); } };
const collecting = { toString() { let s = ""; for (let i = 0; i < 3000; ++i) s += JSON.stringify({ i }).length; return s.slice(-5); } };
const values = ["s", "", "\u{1F600} wide —", 0, -0, 1, -17, 2147483648, 1.5, NaN, Infinity, true, false, null, undefined, 12n, [1, [2]], {}, new Point(3), primitive, valueOf, new Date(0).toISOString(), collecting, throwing, Symbol("sym"), "rope".repeat(9) + String(1), "long ".repeat(50).slice(3)];
const show = value => { try { return typeof value === "symbol" ? value.toString() : typeof value === "function" ? "function" : value === throwing ? "throwing" : typeof value; } catch { return "?"; } };
const attempt = (name, f, ...args) => {
  try {
    note(name + " " + args.map(show).join(",") + " " + JSON.stringify(f(...args)));
  } catch (error) {
    note(name + " " + args.map(show).join(",") + " throws " + error.name + ": " + error.message);
  }
};
for (const value of values) {
  attempt("first", first, value);
  attempt("second", second, value);
  attempt("both", both, value);
  attempt("same", same, value);
  for (const other of ["t", 5, new Point(4), throwing, null]) {
    attempt("pair", pair, value, other);
    attempt("pairWithText", pairWithText, other, value);
    attempt("textThenPair", textThenPair, value, other);
    attempt("pairThenText", pairThenText, other, value);
    attempt("three", three, other, value, 1);
    attempt("three", three, "x", other, value);
    attempt("many", many, value, other, value, other);
    attempt("nested", nested, value, other);
    attempt("held", held, value, other, value);
  }
}
const where = error => error.stack.split("\n").filter(line => line.includes("templates-convert")).slice(0, 3).map(line => line.replace(/.*templates-convert-what-arrives\.mjs:/, "")).join(" | ");
function position(x) {
  return `before ${
    x} after`;
}
function positionOfSecond(x, y) {
  const text = `a ${x} b ${y} c`;
  return text;
}
for (const bad of [throwing, Symbol("q"), { [Symbol.toPrimitive]: 5 }]) {
  try { position(bad); } catch (error) { note("position " + error.name + " " + where(error)); }
  try { positionOfSecond("x", bad); } catch (error) { note("second " + error.name + " " + where(error)); }
  try { positionOfSecond(bad, "y"); } catch (error) { note("first " + error.name + " " + where(error)); }
}
let trace;
const tracing = { toString() { trace = where(new Error("here")); return "traced"; } };
note(both(tracing) + " " + trace);
note(positionOfSecond(1, tracing) + " " + trace);
async function waits(x, y) { const text = `${x} and ${y}`; await null; return `${text} then ${x}.`; }
function inTry(x) { try { return `try ${x}`; } catch (error) { return `caught ${error.message}`; } finally { note(`finally ${typeof x}`); } }
for (const value of [1, "w", new Point(5), throwing]) {
  note(inTry(value));
  try { note(await waits(value, value)); } catch (error) { note("waits " + error.message); }
}
let total = 0;
for (let i = 0; i < 20000; ++i) total += both(i % 3 ? i : "t" + i).length + pairWithText(i, "k").length;
note(String(total));
console.log(lines.join("\n"));
