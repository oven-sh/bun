// Evaluated text is interpreted in an executable: hasOwnProperty() asked again and again of objects of many shapes, with names that are atoms, made at run time, indices, symbols and no strings, while names
// come and go and prototypes change.
const { edenGC, fullGC } = require("bun:jsc");
globalThis.collect = () => void fullGC();
globalThis.collectYoung = () => void edenGC();
globalThis.CompiledClass = class {
  a = 1;
  get g() {
    return 1;
  }
};
globalThis.compiledObject = { a: 1, b: undefined };
const text = `(function () {
  const own = Object.prototype.hasOwnProperty, lines = [];
  class One { a = 1; get b() { return 1; } } class Two extends One { c = 2; }
  const makers = [() => ({ a: 1 }), () => ({ b: 1, a: undefined }), () => ({}), () => Object.create({ a: 1 }), () => Object.create(null), () => new One(), () => new Two(), () => [1, , 3], () => Object.assign([], { a: 1 }), () => function a(b) {}, () => "text", () => 5, () => new CompiledClass(), () => compiledObject, () => Object.freeze({ a: 1 }),
    () => { const o = { a: 1, b: 2 }; delete o.a; return o; }, () => { const o = {}; for (let i = 0; i < 100; i++) o["p" + i] = i; o.a = 1; return o; }, () => new Proxy({ a: 1 }, {}), () => new Proxy({}, { getOwnPropertyDescriptor: (t, k) => k === "a" ? { configurable: true, value: 1 } : undefined }), () => Object.defineProperty({}, "a", { get() { return 1; } }), () => new Map(), () => new Uint8Array(3), () => new String("ab"), () => arguments, () => globalThis, () => null, () => undefined];
  const made = s => { let t = ""; for (const c of s) t += c; return t; };
  const keys = ["a", "b", "c", "length", "name", "prototype", "0", "1", "2", 0, 1, -1, 1.5, made("a"), made("b"), ("xa" + "").slice(1), Symbol.iterator, null, undefined, { toString: () => "a" }, "p50", "missing", "constructor", "toString", "__proto__", "", "é"];
  const ask = (o, k) => { try { return own.call(o, k) ? "y" : "n"; } catch (error) { return error.name[0]; } };
  const direct = (o, k) => { try { return o.hasOwnProperty(k) ? "y" : "n"; } catch (error) { return error.name[0]; } };
  const other = (o, k) => { try { return (Object.hasOwn(o, k) ? "y" : "n") + (k in Object(o) ? "y" : "n"); } catch (error) { return error.name[0]; } };
  const kept = makers.map(make => make());
  for (let turn = 0; turn < 8; turn++) {
    for (const o of kept) lines.push(keys.map(k => ask(o, k)).join(""), keys.map(k => direct(o, k)).join(""));
    for (const make of makers) { const o = make(); lines.push(keys.map(k => ask(o, k) + other(o, k)).join("")); }
    if (turn === 1) for (const o of kept) try { o.missing = 1; } catch {}
    if (turn === 2) collect();
    if (turn === 3) for (const o of kept) try { delete o.a; delete o.missing; } catch {}
    if (turn === 4) collectYoung();
    if (turn === 5) One.prototype.a = 1;
    if (turn === 6) for (const o of kept) try { o.a = 2; Object.defineProperty(o, "c", { get() { return 1; }, configurable: true }); } catch {}
  }
  return lines.join("\\n");
})`;
console.log((0, eval)(text)());
const own = Object.prototype.hasOwnProperty, names = ["a", "b", "g", "missing", JSON.parse('"a"')];
for (const object of [{ a: 1 }, { b: 2 }, new CompiledClass(), compiledObject, JSON.parse('{"a":1}'), [1], "a"]) console.log(names.map(name => own.call(object, name)).join(), names.map(name => Object.hasOwn(object, name)).join());
