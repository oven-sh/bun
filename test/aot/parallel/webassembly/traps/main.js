// Traps of compiled WebAssembly through frames, jobs and callbacks of JavaScript, and that the instance works afterwards.
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
say("traps", tried(() => e.trap()), tried(() => e.trap()), tried(() => e.div(1, 0)), tried(() => e.div(-2147483648, -1)), e.div(7, 2), e.div(-7, 2), tried(() => e.load(65533)), tried(() => e.load(-4)), tried(() => e.store(65536, 1)), e.load(65532));
say("deep", e.deep(10), e.deep(1000), tried(() => e.deep(100000000)), e.deep(10), tried(() => e.deep(-1)), e.add(1, 1));
let n = 0; for (let i = 0; i < 20000; i++) { try { e.div(i, i & 1); n++; } catch {} } say("in a loop", n);
function inner() { return e.trap(); } function outer() { try { return inner(); } finally { n = -1; } } say("through frames", tried(outer), n);
say("in a job", await Promise.resolve().then(() => e.trap()).catch(x => x instanceof WebAssembly.RuntimeError), await (async () => { try { await 0; e.div(1, 0); } catch (x) { return x instanceof WebAssembly.RuntimeError; } })());
say("in a callback", tried(() => [1].map(() => e.trap())), tried(() => [3, 1, 2].sort((p, q) => e.div(p - q, 0))), tried(() => JSON.parse("[1]", () => e.trap())), tried(() => ({ get k() { return e.trap(); } }).k), tried(() => String({ toString: e.trap })), tried(() => [...{ [Symbol.iterator]: e.trap }]));
