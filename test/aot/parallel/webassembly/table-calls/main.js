// Calls through a table of a compiled module: every index, get, set, grow, functions of another instance.
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
for (let i = -1; i < 9; i++) say("index " + i, tried(() => e.viaTable(i, 5)));
say("get", e.table.length, e.tableSize(), e.table.get(0) === e.inc, e.table.get(1) === e.again, e.table.get(4), tried(() => e.table.get(6)), e.table.get(3) === e.add);
say("set", tried(() => e.table.set(4, e.plus77)), e.viaTable(4, 1), tried(() => e.table.set(4, x => x)), tried(() => e.table.set(4, null)), tried(() => e.viaTable(4, 1)), tried(() => e.table.set(9, e.inc)));
say("grow", e.table.grow(1), e.table.length, e.tableSize(), tried(() => e.viaTable(6, 1)), tried(() => e.table.grow(1, e.inc)), e.viaTable(7, 1), tried(() => e.table.grow(1)), e.table.length);
const other = new WebAssembly.Instance(module, { env: { cb: x => x * 100, pair: () => [0, 0], g: 1 } }).exports;
e.table.set(5, other.callCb); e.table.set(4, other.bump.length ? other.inc : other.inc); say("of another instance", e.viaTable(5, 2), e.viaTable(4, 2), e.table.get(5) === other.callCb);
