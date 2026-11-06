// Compiled code calls functions whose text is made at run time, and that text calls compiled code back. A program draws a kind of callee
// (the Function constructors, direct and indirect eval, node:vm, methods, accessors, bound functions ..), a way to call it and a body; inside
// the program the declared parameters, the arguments given and the locals of the callee are crossed, and every callee is called three times.
// No text of a function and no count of frames is printed.
import type { Random } from "./random";

// how a callee is made from (list of parameter names, body text): an expression over `ps` (array of names) and `b` (body)
const kinds = {
  "function-constructor": { make: "new Function(...ps, b)" },
  "function-constructor-strict": { make: "new Function(...ps, '\"use strict\";\\n' + b)" },
  "function-without-new": { make: "Function(ps.join(), b)" },
  "indirect-eval-function": { make: '(0, eval)("(function (" + ps.join() + ") {\\n" + b + "\\n})")' },
  "direct-eval-function": { make: 'eval("(function (" + ps.join() + ") {\\n" + b + "\\n})")' },
  "indirect-eval-arrow": { make: '(0, eval)("((" + ps.join() + ") => {\\n" + b + "\\n})")', arrow: true },
  "eval-method": { make: '(0, eval)("({ m(" + ps.join() + ") {\\n" + b + "\\n} })").m', method: true },
  "eval-static-method": {
    make: '(0, eval)("(class { static m(" + ps.join() + ") {\\n" + b + "\\n} })").m',
    method: true,
  },
  "eval-class": {
    make: '(0, eval)("(class K { constructor(" + ps.join() + ") {\\n" + b + "\\n} })")',
    constructor: true,
  },
  "eval-derived-class": {
    make: '(0, eval)("(class K extends Base { constructor(" + ps.join() + ") {\\nsuper();\\n" + b + "\\n} })")',
    constructor: true,
  },
  "async-function-constructor": { make: "new (async function () {}).constructor(...ps, b)", method: true },
  "generator-function-constructor": { make: "new (function* () {}).constructor(...ps, b)", method: true },
  "bound": { make: 'new Function(...ps, b).bind({ tag: "bound-this" })' },
  "bound-with-an-argument": { make: 'new Function(...ps, b).bind({ tag: "bound-this" }, "bound-argument")' },
  "bound-twice": { make: 'new Function(...ps, b).bind({ tag: "first" }, 1).bind({ tag: "second" }, 2)' },
  "proxy": { make: "new Proxy(new Function(...ps, b), {})" },
  "proxy-with-compiled-traps": {
    make: "new Proxy(new Function(...ps, b), { apply(f, t, a) { return Reflect.apply(f, t, a); }, construct(f, a, n) { return Reflect.construct(f, a, n); } })",
  },
  "other-realm-function": { make: 'vm.runInContext("(function (" + ps.join() + ") {\\n" + b + "\\n})", realm)' },
  "other-realm-function-constructor": { make: 'vm.runInContext("Function", realm)(...ps, b)' },
  "other-realm-bound": {
    make: 'vm.runInContext("(function (" + ps.join() + ") {\\n" + b + "\\n}).bind(null, 5)", realm)',
  },
  "compile-function": { make: "vm.compileFunction(b, ps)" },
  "inner-function-of-text": {
    make: 'new Function("held", "return function (" + ps.join() + ") {\\nheld++;\\n" + b + "\\n}")(1)',
  },
  "rest-and-defaults": {
    make: 'new Function(...ps.map((p, i) => (i === ps.length - 1 ? "..." + p : i % 2 ? p + " = \'default\'" : p)), b)',
  },
};

// how compiled code calls f with `t` as this and the array `a`: the body of function callIt(f, t, a)
const sites = (head, tail = "") =>
  "switch (a.length) {\n" +
  [0, 1, 2, 3, 4, 5, 6, 7]
    .map(n => `    case ${n}: ${head}(${Array.from({ length: n }, (_, i) => `a[${i}]`).join(", ")})${tail};`)
    .join("\n") +
  "\n  }";
const sitesAfter = (head, first) =>
  "switch (a.length) {\n" +
  [0, 1, 2, 3, 4, 5, 6, 7]
    .map(n => `    case ${n}: ${head}(${[first, ...Array.from({ length: n }, (_, i) => `a[${i}]`)].join(", ")});`)
    .join("\n") +
  "\n  }";
const ways = {
  "direct": sites("return f"),
  "method": "const o = { tag: 'receiver', f };\n  " + sites("return o.f"),
  "computed-method": "const o = { tag: 'receiver', f }, k = ['f'][a.length & 0];\n  " + sites("return o[k]"),
  "call": sitesAfter("return f.call", "t"),
  "apply": "return f.apply(t, a);",
  "reflect-apply": "return Reflect.apply(f, t, a);",
  "spread": "return f(...a);",
  "optional": sites("return f?."),
  "result-is-used": sites("{ const r = f", "; return typeof r === 'string' ? r + '' : r; }"),
  "inside-try-finally": "try {\n  " + sites("return f") + "\n  } finally { side++; }",
  "new": sites("return new f"),
  "reflect-construct": "return Reflect.construct(f, a);",
  "reflect-construct-other-target": "return Reflect.construct(f, a, Target);",
  "tagged-template": "return f`x${a[0]}y${a[1]}z`;",
  "getter": "const o = { tag: 'receiver' };\n  Object.defineProperty(o, 'g', { get: f });\n  return o.g;",
  "setter":
    "const o = { tag: 'receiver' };\n  Object.defineProperty(o, 's', { set: f });\n  o.s = a[0];\n  return 'stored';",
  "map-callback": "return [a[0], a[1]].map(f, t);",
  "sort-callback": "return [3, 1, 2].sort((x, y) => (f(x, y), x - y)).join();",
  "then-callback": "return Promise.resolve(a[0]).then(f);",
  "value-of": "return '' + { tag: 'receiver', valueOf: f, toString: null };",
  "replace-callback": "return 'abc'.replace(/b/, f);",
};

// what the callee does behind its digest `d`
const bodies = {
  "returns": "return d;",
  "calls-back": "return back(d);",
  "calls-back-with-this": "return back.call(p0x, d, 1, 2, 3, 4);",
  "throws": "throw new Error(d);",
  "callback-throws": "try { thrower(d); } catch (e) { return 'caught ' + e.message; }",
  "returns-in-finally": "try { return d; } finally { note('finally'); }",
  "collects":
    "var kept = [{ d: d }, [d], d + '!']; collect(); return kept[0].d === d && kept[1][0] === d ? kept[2] : 'lost';",
  "comes-again": "return again(d);",
  "value-by-number": "return values(count());",
  "until-the-stack-ends": "return forever(d);",
};

const prelude = `import vm from "node:vm";
process.on("unhandledRejection", () => {});
const lines = [];
let side = 0, calls = 0, depth = 0, current = null;
function kindOf(v) {
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  if (v === globalThis) return "global";
  if (v === realmGlobal) return "other-global";
  const t = typeof v;
  if (t === "function") return "function";
  if (t === "symbol") return "symbol " + v.description;
  if (t === "bigint") return v + "n";
  if (t === "number") return Object.is(v, -0) ? "-0" : String(v);
  if (t === "string") return JSON.stringify(v);
  if (t === "boolean") return String(v);
  if (Array.isArray(v)) return "[" + v.map(kindOf).join() + "]";
  if (typeof v.tag === "string") return "{" + v.tag + "}";
  if (typeof v.then === "function") return "promise";
  const keys = Object.keys(v).sort();
  return Object.prototype.toString.call(v).slice(8, -1) + "{" + keys.map(k => k + ":" + kindOf(v[k])).join() + "}";
}
function note(text) { lines.push("  note " + text); }
function back(a, b, c) { return "back(" + kindOf(this) + "," + kindOf(a) + "," + kindOf(b) + "," + kindOf(c) + "," + arguments.length + ")"; }
function thrower(text) { throw new RangeError("thrown " + text); }
function collect() { Bun.gc(true); }
function count() { return calls; }
function values(i) { return [0, 1.5, -0, NaN, "text", 12n, Symbol.for("s"), { tag: "object" }, [1, [2]], undefined, null, true, 2 ** 31, -(2 ** 31) - 1, 1e300, ""][i % 17]; }
function again(d) { if (depth++ < 40) return current(); return d; }
function forever(d) { return current(); }
class Base { constructor() { this.base = 1; } }
function Target() {}
Target.prototype.tag = "made-for-target";
const shared = { kindOf, note, back, thrower, collect, count, values, again, forever, Base };
Object.assign(globalThis, shared);
const realm = vm.createContext({ ...shared });
const realmGlobal = vm.runInContext("globalThis", realm);
`;

// the callee's text: locals that are read before they are given a value, then filled from the parameters
const textOf = `function textOf(ps, locals, flavor, rest) {
  let b = "";
  const vs = Array.from({ length: locals }, (_, i) => "v" + i);
  if (locals) b += "var " + vs.join(", ") + ";\\n";
  b += "var early = 0, sum = '';\\n";
  for (const v of vs) b += "if (" + v + " !== undefined) early++;\\n";
  vs.forEach((v, i) => { b += v + " = " + (ps.length ? ps[i % ps.length] : i) + ";\\n"; });
  if (locals) b += "sum = kindOf([" + [vs[0], vs[locals >> 1], vs[locals - 1]].join() + "]);\\n";
  b += "var p0x = " + (ps.length ? ps[0] : "undefined") + ";\\n";
  b += "var d = 'k|' + " + (flavor === "arrow" ? "'arrow'" : "kindOf(this) + '|' + arguments.length") + " + '|' + kindOf([" + ps.join() + "]) + '|' + early + '|' + sum;\\n";
  if (flavor === "constructor") b += "this.d = d;\\n";
  if (flavor === "function") b += "if (new.target) this.d = d + '|new ' + (new.target.prototype === Object.getPrototypeOf(this));\\n";
  return b + rest;
}
`;

const localsList = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 30, 31, 32, 33, 34, 47,
  48, 49, 63, 64, 65, 66, 100, 127, 128, 129, 255, 256, 257, 400,
];
export function generate(random: Random): string {
  for (;;) {
    {
      const k: any = random.pick(Object.values(kinds));
      const [way, site] = random.pick(Object.entries(ways));
      const [body, rest] = random.pick(Object.entries(bodies));
      const flavor = k.arrow ? "arrow" : k.constructor ? "constructor" : k.method ? "method" : "function";
      const endless = body === "until-the-stack-ends";
      if (endless && way === "then-callback") continue;
      const text = `${prelude}${textOf}
function make(ps, b) { return ${k.make}; }
function callIt(f, t, a) {
  ${site}
}
function twin(x, y) { return "twin|" + kindOf(this) + "|" + arguments.length + "|" + kindOf([x, y]); }
async function settle(r) {
  if (r !== null && typeof r === "object" && typeof r.next === "function" && typeof r.then !== "function") r = r.next().value;
  return kindOf(await r);
}
async function one(name, f, t, a) {
  let r;
  depth = 0;
  current = () => callIt(f, t, a);
  try { r = await settle(callIt(f, t, a)); } catch (e) { r = "throws " + e.name + (String(e.message).startsWith("k|") || String(e.message).startsWith("thrown") ? " " + e.message : ""); }
  calls++;
  lines.push(name + " " + r);
}
const given = [1, "two", { tag: "three" }, 4.5, null, undefined, 7n];
const list = ${JSON.stringify(localsList)};
let turn = ${random.below(localsList.length)};
for (const declared of ${endless ? "[2]" : "[0, 1, 2, 3, 6]"})
  for (const passed of ${endless ? "[2]" : "[0, 1, 2, 3, 4, 7]"}) {
    const locals = list[turn++ % list.length];
    const ps = Array.from({ length: declared }, (_, i) => "p" + i);
    let f;
    try { f = make(ps, textOf(ps, locals, ${JSON.stringify(flavor)}, ${JSON.stringify(rest)})); } catch (e) { lines.push("not made: " + e.name); continue; }
    const a = given.slice(0, passed);
    for (let round = 0; round < 3; round++) {
      await one(declared + "/" + passed + "/" + locals + " #" + round, f, round === 1 ? 5 : { tag: "this" }, a);
      if (round === 1) { await one("  twin", twin, { tag: "this" }, a); await one("  native", String, { tag: "this" }, a); }
    }
  }
${endless ? "" : 'lines.push("side " + side + " calls " + calls);'}
console.log(lines.join("\\n"));
`;
      return text;
    }
  }
}
