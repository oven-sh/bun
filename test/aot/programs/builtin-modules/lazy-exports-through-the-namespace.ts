// The namespace objects of node:fs, node:process, node:module and bun used as values. A namespace answers every export under a key that only the running program knows, also an export that the module creates on first use, and it creates that export once.
import * as fs from "node:fs";
import * as processModule from "node:process";
import * as moduleModule from "node:module";

const key = process.argv.length > 99 ? "x" : "WriteStream";
console.log(typeof (fs as any)[key]);
console.log(Object.keys(fs).includes("promises"));
console.log("ReadStream" in fs);
console.log((fs as any).default.ReadStream === fs.ReadStream);
console.log((fs as any)[key] === (fs as any).default[key]);
console.log(typeof Object.getOwnPropertyDescriptor(fs, "Utf8Stream")?.value);
console.log(Object.keys(fs).filter(name => typeof (fs as any)[name] === "object").join());
console.log(Object.keys(fs).filter(name => (fs as any)[name] !== (fs as any).default[name]).join());

const processKey = process.argv.length > 99 ? "x" : "stdout";
console.log((processModule as any)[processKey] === process.stdout, "stdin" in processModule, Object.keys(processModule).includes("stderr"));

// Module.wrapper answers another object each time it is read.
const moduleKey = process.argv.length > 99 ? "x" : "wrapper";
console.log((moduleModule as any)[moduleKey] === (moduleModule as any)[moduleKey], (moduleModule as any).default[moduleKey] === (moduleModule as any).default[moduleKey]);
console.log("createRequire" in moduleModule, Object.keys(moduleModule).includes("builtinModules"));

// Written as a literal, the specifier "bun" is the global Bun and no module is loaded.
const specifier = "bun";
const bun = await import(specifier);
const bunKey = process.argv.length > 99 ? "x" : "Glob";
console.log(bun[bunKey] === Bun.Glob, "serve" in bun, bun.default === Bun);
