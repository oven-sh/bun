// Two instances of one compiled module have their own globals, memories and imports; what does not link.
// STATISTIC: WasmFunctionsCompiled >= 22
import path from "../module-facts/m.wasm";
import fs from "node:fs";
const tried = f => { try { const r = f(); return typeof r === "bigint" ? r + "n" : Array.isArray(r) ? "[" + r + "]" : String(r); } catch (e) { return e instanceof WebAssembly.RuntimeError ? "RuntimeError" : e instanceof WebAssembly.LinkError ? "LinkError" : e instanceof WebAssembly.CompileError ? "CompileError" : e instanceof RangeError ? "RangeError" : e instanceof TypeError ? "TypeError" : "thrown " + String(e); } };
const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
const module = new WebAssembly.Module(bytes);
let cb = x => x * 2, pair = () => [9, 4];
const calls = [];
const imports = () => ({ env: { cb: x => (calls.push(x), cb(x)), pair: () => pair(), g: 42 } });
const e = new WebAssembly.Instance(module, imports()).exports;
const say = (word, ...all) => console.log(word, all.join(" | "));
const g = new WebAssembly.Global({ value: "i32", mutable: false }, 7);
const a = new WebAssembly.Instance(module, { env: { cb: x => x, pair: () => [0, 0], g } }).exports, b = new WebAssembly.Instance(module, { env: { cb: x => -x, pair: () => [0, 0], g: 8 } }).exports;
say("each its own", a.readG(), b.readG(), e.readG(), a.bump(), a.bump(), b.bump(), a.counter.value, b.counter.value, a.callCb(5), b.callCb(5));
a.store(8, 1); b.store(8, 2); say("memories", a.load(8), b.load(8), e.load(8), a.memory === b.memory, a.add === b.add, a.table === b.table);
a.counter.value = -5; say("set from outside", a.bump(), b.bump(), tried(() => { g.value = 1; }), a.counter instanceof WebAssembly.Global, a.counter.valueOf());
for (const [word, env] of Object.entries({ "no env": undefined, "no cb": { pair() {}, g: 1 }, "cb no function": { cb: 5, pair() {}, g: 1 }, "g a text": { cb() {}, pair() {}, g: "1" }, "g a bigint": { cb() {}, pair() {}, g: 1n }, "g mutable": { cb() {}, pair() {}, g: new WebAssembly.Global({ value: "i32", mutable: true }, 1) }, "g of another type": { cb() {}, pair() {}, g: new WebAssembly.Global({ value: "f64" }, 1) }, "g undefined": { cb() {}, pair() {} } })) say("links " + word, tried(() => typeof new WebAssembly.Instance(module, env === undefined ? {} : { env }).exports));
say("no imports at all", tried(() => new WebAssembly.Instance(module)), tried(() => new WebAssembly.Instance(module, 5)), tried(() => WebAssembly.Instance(module, imports())));
const wired = new WebAssembly.Instance(module, { env: { cb: a.inc, pair: a.two.bind(null, 3), g: 0 } }).exports; say("an export for an import", wired.callCb(5), wired.again === a.inc, wired.again(1), wired.usePair(), wired.loopCb(10));
