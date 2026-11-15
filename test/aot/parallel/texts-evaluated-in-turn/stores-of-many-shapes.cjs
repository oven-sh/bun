// Evaluated text is interpreted in an executable: sites that store to objects of many shapes: names that the object has, names that it gains in the cell, in its first storage and in storage that grows,
// setters of every kind, names that may not be written, prototypes that change in the middle, and objects that are the only one of their shape.
const { edenGC, fullGC } = require("bun:jsc");
const lines = [];
globalThis.log = (...values) => void lines.push(values.map(value => (Object.is(value, -0) ? "-0" : typeof value === "bigint" ? `${value}n` : typeof value === "symbol" ? value.toString() : typeof value === "function" ? "function" : JSON.stringify(value) ?? String(value))).join(" "));
globalThis.collect = () => void fullGC();
globalThis.collectYoung = () => void edenGC();
globalThis.CompiledClass = class {
  a = 3;
  set late(value) {
    this.a = value;
  }
};
globalThis.compiledSetter = function (value) {
  this.hidden = `compiled ${value} ${arguments.length}`;
};
const evaluate = text => {
  try {
    log((0, eval)(text));
  } catch (error) {
    log(error instanceof Error ? `${error.name}: ${error.message}` : error);
  }
};
const setters = ["function (v) { this.hidden = v; }", "function () { this.hidden = arguments.length; }", "function (a, b, c) { this.hidden = [a, b, c, arguments.length].join(); }", "function (v) { throw new Error('thrown ' + v); }", "function (v) { collect(); this.hidden = v; }", "function (v) { if (this.depth-- > 0) this.a = v; else this.hidden = v; }", "function (v) { Object.defineProperty(this, 'a', { value: v, writable: true, configurable: true }); }", "function (v) { delete this.a; this.a = v; }", "function (v) { this.a = v; }", "compiledSetter", "compiledSetter.bind({})", "class {}", "undefined", "Math.max", "new Proxy(function () {}, { apply: (target, self, list) => { self.hidden = 'proxy ' + list; } })"];
const changes = ["Object.defineProperty(One.prototype, 'late', { set(v) { this.seen = v; }, configurable: true })", "Object.defineProperty(One.prototype, 'late', { value: 1, writable: false, configurable: true })", "Object.setPrototypeOf(Two.prototype, { set late(v) { this.above = v; } })", "for (const o of kept) try { Object.freeze(o); } catch {}", "for (const o of kept) try { Object.preventExtensions(o); } catch {}", "for (const o of kept) try { Object.defineProperty(o, 'a', { writable: false }); } catch {}", "for (const o of kept) if (typeof o === 'object') try { delete o.a; } catch {}", "collect()", "collectYoung()"];
for (const strict of ["", "'use strict';"])
  for (let round = 0; round < setters.length; round++)
    evaluate(`(function () { ${strict}
    class One { m() {} n = 1; } class Two { b = 1; a = "two"; } class Heir extends One { own = 1; }
    const answers = [], show = x => { try { return typeof x === "object" && x ? JSON.stringify(x) : typeof x === "function" ? "function" : String(x); } catch { return "x"; } }, attempt = f => { try { answers.push(show(f())); } catch (error) { answers.push(error.name); } };
    const makers = [
      () => ({ a: 1 }), () => ({ b: 1, a: 2 }), () => ({ c: 1, b: 2, a: 3 }), () => ({}), () => ({ b: 1 }), () => Object.create({ a: "above" }), () => Object.create(null), () => new One(), () => new Two(), () => new Heir(), () => new CompiledClass(),
      () => Object.defineProperty({ hidden: 0, depth: 2 }, "a", { set: ${setters[round]}, configurable: true }), () => Object.create(Object.defineProperty({}, "a", { set: ${setters[round]}, configurable: true }), { hidden: { writable: true, value: 1 }, depth: { writable: true, value: 1 } }),
      () => Object.freeze({ a: "frozen" }), () => Object.seal({ a: "sealed" }), () => Object.defineProperty({}, "a", { value: "fixed", configurable: true }), () => { const o = { a: 1, b: 2 }; delete o.a; return o; }, () => [1], () => function () {}, () => "text", () => 5,
      () => { const o = {}; for (let i = 0; i < 100; i++) o["p" + i] = i; return o; }, () => new Proxy({}, {}), () => new Proxy({}, { set: () => true }), () => ({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 }),
    ], kept = makers.map(make => make());
    const store = (o, v) => { o.a = v; return o.a; }, late = (o, v) => { o.late = v; return o.late; }, many = (o, v) => { o.x1 = v; o.x2 = v; o.x3 = v; o.x4 = v; o.x5 = v; o.x6 = v; o.x7 = v; return [o.x1, o.x5, o.x7, Object.keys(Object(o)).length].join(); }, more = (o, v) => { o.a++; o.late ??= v; return o.a; };
    for (let turn = 0; turn < 10; turn++) {
      for (const make of makers) for (const site of [store, late, many, more]) attempt(() => site(make(), turn));
      for (const o of kept) for (const site of [store, late, more]) attempt(() => site(o, turn % 2 ? "s" + turn : { turn }));
      if (turn === 6) attempt(() => { ${changes[round % changes.length]}; return "changed"; });
    }
    for (const o of kept) attempt(() => Object.keys(o).length < 20 && typeof o !== "function" ? o : "many");
    let hash = 0;
    for (const answer of answers) for (let k = 0; k < answer.length; k++) hash = (Math.imul(hash, 31) + answer.charCodeAt(k)) | 0;
    return [answers.length, hash, ...answers.slice(-120)];
  })()`);
console.log(lines.join("\n"));
