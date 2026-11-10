// A module of WebAssembly that is imported as a file is compiled like one that is imported as WebAssembly.
// A file that only has the name of one is carried as it is.
// STATISTIC: WasmFunctionsCompiled >= 22
import written from "../module-facts/m.wasm" with { type: "file" };
import words from "./words.wasm" with { type: "file" };
import fs from "node:fs";
const { default: asked } = await import("../module-facts/m.wasm", { with: { type: "file" } });
const imports = () => ({ env: { cb: x => x * 2, pair: () => [9, 4], g: 42 } });
const run = bytes => {
  const e = new WebAssembly.Instance(new WebAssembly.Module(bytes), imports()).exports;
  return e.plus77(1) + " " + e.counter.value;
};
console.log(typeof written, written === asked);
console.log("read by node:fs", run(fs.readFileSync(written)));
console.log("read by Bun.file", run(new Uint8Array(await Bun.file(asked).arrayBuffer())));
console.log("instantiate", (await WebAssembly.instantiate(fs.readFileSync(asked), imports())).instance.exports.plus77(2));
console.log("only the name", JSON.stringify(fs.readFileSync(words, "utf8")), WebAssembly.validate(fs.readFileSync(words)));
