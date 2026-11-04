// How the operands and results of compiled functions of WebAssembly are converted, and in which order.
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
say("add", e.add("3", { valueOf() { return 4; } }), e.add(1.9, -1.9), e.add(2 ** 32 + 5, NaN), e.add(undefined), e.add(), e.add(1, 2, 3, 4), e.add(null, true), e.add(Infinity, -Infinity), e.add(2147483647, 1), e.add(-0, 0), tried(() => e.add(Symbol.iterator, 1)), tried(() => e.add(1n, 1)), e.add([7], "0x10"));
say("id64", tried(() => e.id64(5)), tried(() => e.id64(5n)), tried(() => e.id64(2n ** 64n + 1n)), tried(() => e.id64(-(2n ** 63n) - 1n)), tried(() => e.id64("7")), tried(() => e.id64(true)), tried(() => e.id64(undefined)), tried(() => e.id64({ valueOf() { return 8n; } })), tried(() => e.id64("x")));
say("idf", e.idf(0.1), e.idf(NaN), Object.is(e.idf(-0), -0), e.idf(1e40), e.idf(16777217), e.idf("1.5"), e.idf(undefined), e.idf(1e-46));
say("mixed", e.mixed(1, 2n, 0.5, 0.25), tried(() => e.mixed(1, 2, 0.5, 0.25)), e.mixed("1", 2n, "0.5", "0.25"));
const order = []; e.mixed({ valueOf() { order.push("a"); return 1; } }, { valueOf() { order.push("b"); return 1n; } }, { valueOf() { order.push("c"); return 1; } }, { valueOf() { order.push("d"); return 1; } }); say("order", order.join());
say("two", tried(() => e.two(4)), Array.isArray(e.two(4)), e.usePair(), (pair = () => new Set([20, 1]), e.usePair()), (pair = () => [1], tried(() => e.usePair())), (pair = () => [1, 2, 3], tried(() => e.usePair())), (pair = () => 5, tried(() => e.usePair())), (pair = () => ["30", { valueOf() { return 8; } }], e.usePair()));
