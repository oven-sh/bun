// Evaluated text is interpreted in an executable: getters of ordinary objects, which the interpreter calls by itself once their place is known: own and inherited ones, with few and many
// parameters, written in the text, compiled, native, bound and proxies, that throw, recurse, collect, and change the object, its prototype or themselves.
const { edenGC, fullGC } = require("bun:jsc");
const lines = [];
globalThis.log = (...values) => void lines.push(values.map(value => (Object.is(value, -0) ? "-0" : typeof value === "bigint" ? `${value}n` : typeof value === "symbol" ? value.toString() : typeof value === "function" ? "function" : JSON.stringify(value) ?? String(value))).join(" "));
globalThis.collect = () => void fullGC();
globalThis.collectYoung = () => void edenGC();
globalThis.compiled = function () {
  return `compiled ${typeof this} ${arguments.length} ${this?.hidden}`;
};
globalThis.CompiledClass = class {
  get a() {
    return this.hidden;
  }
  hidden = 9;
};
const evaluate = text => {
  try {
    log((0, eval)(text));
  } catch (error) {
    log(error instanceof Error ? `${error.name}: ${error.message}` : error);
  }
};

const getters = [
  "function () { return this.hidden; }",
  "function () { 'use strict'; return [typeof this, arguments.length]; }",
  "function (a, b, c, d) { return [a, d, arguments.length]; }",
  "function (a = 1, ...rest) { return [a, rest.length]; }",
  "function () { var a, b, c, d, e, f, g, h, i; return [a, b, c, d, e, f, g, h, i].length + this.hidden; }",
  "function () { throw new Error('thrown ' + this.hidden); }",
  "function () { return this.depth-- > 0 ? this.a : 'deep'; }",
  "function () { collect(); return { k: this.hidden }; }",
  "function () { collectYoung(); return 'young'; }",
  "function () { delete this.a; return 'deleted'; }",
  "function () { Object.defineProperty(this, 'a', { value: 7, configurable: true, writable: true }); return 'now a value'; }",
  "function () { Object.setPrototypeOf(this, { other: 1 }); return this.other; }",
  "function () { return this.a; }",
  "() => 'arrow'",
  "class {}",
  "compiled",
  "compiled.bind({ hidden: 'bound' })",
  "CompiledClass",
  "new Proxy(function () {}, { apply: (target, self, list) => 'proxy ' + list.length + self.hidden })",
  "Object.getOwnPropertyDescriptor(Map.prototype, 'size').get",
  "Object.getOwnPropertyDescriptor(RegExp.prototype, 'flags').get",
  "Object.prototype.valueOf",
  "Math.max",
  "function* () { yield 1; }",
  "async function () { return 1; }",
  "undefined",
];
for (const getter of getters)
  evaluate(`(function () {
    const answers = [], attempt = f => { try { const x = f(); answers.push(typeof x === "object" && x ? Object.keys(x).join() || String(x) : typeof x === "function" ? "function" : String(x)); } catch (error) { answers.push(error.name + (error instanceof RangeError ? "" : " " + error.message.split(" (")[0])); } };
    const makers = [
      () => Object.defineProperty({ hidden: "own", depth: 3 }, "a", { get: ${getter}, configurable: true, enumerable: true }),
      () => Object.create(Object.defineProperty({ p: 1 }, "a", { get: ${getter}, configurable: true }), { hidden: { value: "above" }, depth: { value: 2, writable: true } }),
      () => Object.defineProperty({ b: 1, c: 2, d: 3, e: 4, f: 5, g: 6, h: 7, hidden: "wide", depth: 1 }, "a", { get: ${getter}, configurable: true }),
      () => Object.defineProperty([1], "a", { get: ${getter}, configurable: true }),
      () => Object.defineProperty(function () {}, "a", { get: ${getter}, configurable: true }),
    ];
    for (const make of makers) {
      const read = o => o.a, twice = o => [o.a, o.hidden, o.a].length, caught = o => { try { return o.a; } catch (error) { return "caught " + error.name; } finally { answers.push("finally"); } };
      const wide = o => { ${Array.from({ length: 140 }, (_, i) => `let w${i} = ${i};`).join(" ")} return [w139, o.a].length; };
      function* step(o) { yield o.a; yield o.a; }
      const kept = make();
      for (let turn = 0; turn < 4; turn++) attempt(() => read(make()));
      for (let turn = 0; turn < 3; turn++) attempt(() => read(kept));
      for (let turn = 0; turn < 3; turn++) attempt(() => twice(make()));
      for (let turn = 0; turn < 3; turn++) attempt(() => caught(make()));
      for (let turn = 0; turn < 3; turn++) attempt(() => wide(make()));
      for (let turn = 0; turn < 2; turn++) attempt(() => [...step(make())]);
      for (const other of [{ a: 1 }, {}, new Map(), /x/g, "text", 5, null, new CompiledClass(), make()]) attempt(() => read(other));
    }
    return answers;
  })()`);
log(lines.length);
console.log(lines.join("\n"));
