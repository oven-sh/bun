// The memory of a compiled module as JavaScript sees it: views, growth, a collection.
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
const first = e.memory.buffer, view = new Uint8Array(first); view[100] = 9; say("written outside", e.load(100), first.byteLength);
e.store(200, 0x01020304); say("written inside", view[200], view[203], new DataView(first).getInt32(200, true));
say("grown", e.growBy(1), first.byteLength, view.length, view[100], e.memory.buffer === first, e.memory.buffer.byteLength, new Uint8Array(e.memory.buffer)[100], e.load(100));
say("cannot be handed away", tried(() => structuredClone(e.memory.buffer, { transfer: [e.memory.buffer] }).byteLength), tried(() => e.memory.buffer.transfer().byteLength), e.load(100), tried(() => e.memory.buffer.resize(1)));
say("to its end", e.growBy(1), e.growBy(1), tried(() => e.memory.grow(1)), e.memory.buffer.byteLength, e.load(196604), tried(() => e.load(196605)));
Bun.gc(true); say("behind a collection", e.load(100), e.load(200));
let kept = (() => new WebAssembly.Instance(module, imports()).exports.bump)(); Bun.gc(true); say("only a function is kept", kept(), kept());
