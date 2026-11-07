// What a compiled module of WebAssembly and its exports say about themselves.
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
say("exports", WebAssembly.Module.exports(module).map(x => x.name + ":" + x.kind).join());
say("imports", WebAssembly.Module.imports(module).map(x => x.module + "." + x.name + ":" + x.kind).join());
say("keys", Object.keys(e).join(), Object.isFrozen(e), Object.getPrototypeOf(e) === null);
say("function", e.add.name, e.add.length, e.mixed.length, typeof e.add, e.add instanceof Function, tried(() => new e.add(1, 2)), e.add.call({ any: 1 }, 1, 2), e.add.apply(null, [3, 4]), e.add.bind(null, 5)(6), [1, 2, 3].map(e.inc).join(), "prototype" in e.add);
say("start", calls.join(), e.counter.value);
say("validate", WebAssembly.validate(bytes), WebAssembly.validate(bytes.subarray(0, 20)), tried(() => new WebAssembly.Module(bytes.subarray(0, 20))), WebAssembly.Module.customSections(module, "none").length);
