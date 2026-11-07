// The bytes of a compiled module reach WebAssembly by other routes, and with a byte changed they are another module.
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
const run = x => tried(() => x.plus77(1) + " " + x.counter.value);
say("a Buffer", run(new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(path)), imports()).exports));
say("an ArrayBuffer", run(new WebAssembly.Instance(new WebAssembly.Module(bytes.buffer), imports()).exports));
const wide = new Uint8Array(bytes.length + 16); wide.set(bytes, 8); say("a view in the middle", run(new WebAssembly.Instance(new WebAssembly.Module(wide.subarray(8, 8 + bytes.length)), imports()).exports));
say("instantiate(bytes)", run((await WebAssembly.instantiate(bytes, imports())).instance.exports));
say("compile, instantiate(module)", run((await WebAssembly.instantiate(await WebAssembly.compile(bytes), imports())).exports));
say("streaming", await (async () => { try { return run((await WebAssembly.instantiateStreaming(new Response(bytes, { headers: { "content-type": "application/wasm" } }), imports())).instance.exports); } catch (x) { return "refused " + (x instanceof TypeError); } })());
say("the module twice", run(new WebAssembly.Instance(new WebAssembly.Module(bytes), imports()).exports), new WebAssembly.Module(bytes) === module);
const at = bytes.findIndex((b, i) => b === 0x41 && bytes[i + 1] === 0xcd && bytes[i + 2] === 0x00); const changed = bytes.slice(); changed[at + 1] = 0xce; say("one byte changed", at > 0, run(new WebAssembly.Instance(new WebAssembly.Module(changed), imports()).exports), run(e));
const longer = new Uint8Array(bytes.length + 5); longer.set(bytes); longer.set([0, 3, 1, 0x78, 9], bytes.length); say("a custom section more", run(new WebAssembly.Instance(new WebAssembly.Module(longer), imports()).exports), WebAssembly.Module.customSections(new WebAssembly.Module(longer), "x").length);
const late = bytes.slice(); const lateModule = new WebAssembly.Module(late); late[at + 1] = 0xce; say("changed behind the compilation", run(new WebAssembly.Instance(lateModule, imports()).exports));
const broken = bytes.slice(); broken[at] = 0xff; say("broken", tried(() => new WebAssembly.Module(broken)), WebAssembly.validate(broken));
say("copied by structuredClone", tried(() => run(new WebAssembly.Instance(structuredClone(module), imports()).exports)));
