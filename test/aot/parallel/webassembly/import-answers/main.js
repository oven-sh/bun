// What a function of JavaScript that a compiled module imports may answer, throw and change.
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
for (const [word, f] of Object.entries({ text: () => "12", nothing: () => undefined, object: () => ({ valueOf() { return 7; } }), wide: () => 2 ** 32 + 1, fraction: () => 1.9, big: () => 1n, symbol: () => Symbol.iterator, nan: () => NaN })) { cb = f; say("answers " + word, tried(() => e.callCb(1)), tried(() => e.again(1)), tried(() => e.viaTable(1, 1)), tried(() => e.loopCb(3))); }
const thrown = new RangeError("mine"); cb = () => { throw thrown; }; let caught; try { e.callCb(1); } catch (x) { caught = x; } say("the very error", caught === thrown, tried(() => e.viaTable(1, 1)), tried(() => e.loopCb(2)));
cb = () => { throw 5; }; say("a number is thrown", tried(() => e.callCb(1)));
let ran = ""; cb = () => { throw thrown; }; try { try { e.callCb(1); } finally { ran += "finally"; } } catch { ran += " catch"; } say("finally", ran);
cb = x => (x > 0 ? e.callCb(x - 1) : 0); say("comes back in", e.callCb(5), e.callCb(50));
cb = x => e.trap(); say("traps inside", tried(() => e.callCb(1)), e.add(1, 1));
cb = x => e.callCb(x); say("without end", tried(() => e.callCb(1)), e.add(1, 1));
cb = x => (e.memory.grow(1), 1); e.store(0, 77); say("grows the memory", e.callCb(1), e.load(0), e.memory.buffer.byteLength);
cb = x => (e.table.set(0, e.plus77), 1); say("changes the table", e.viaTable(0, 1), e.callCb(1), e.viaTable(0, 1));
cb = x => (e.counter.value = 1000, 1); say("changes the global", e.bump(), e.callCb(1), e.bump());
cb = x => x; let sum = 0; for (let i = 0; i < 100000; i++) sum = (sum + e.callCb(i)) | 0; say("many", sum, e.loopCb(100000));
