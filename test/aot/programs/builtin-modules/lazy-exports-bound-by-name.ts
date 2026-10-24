// Exports that a built-in module creates on first use, each bound by a named import: fs.ReadStream loads node:stream, fs.promises loads node:fs/promises, process.stdout opens the stream. Each binding holds what the module's own object answers.
import { ReadStream, WriteStream, promises, Utf8Stream, lstatSync } from "node:fs";
import { stdout, argv } from "node:process";
import { builtinModules, createRequire } from "node:module";
import { version, Glob } from "bun";

console.log(typeof ReadStream, typeof WriteStream, typeof promises, typeof Utf8Stream, typeof lstatSync);
console.log(typeof stdout, typeof argv, typeof builtinModules, typeof createRequire, typeof version, typeof Glob);

console.log(ReadStream === (await import("node:fs")).ReadStream);
console.log(promises === (await import("node:fs/promises")).default);
console.log(WriteStream === require("node:fs").WriteStream, Utf8Stream === require("node:fs").Utf8Stream);
console.log(stdout === process.stdout, argv === process.argv, version === Bun.version, Glob === Bun.Glob);
console.log(builtinModules === require("node:module").builtinModules, createRequire === require("node:module").createRequire);

console.log(lstatSync(".").isDirectory(), typeof ReadStream.prototype.pipe, typeof promises.readFile, typeof stdout.write);
console.log(new Glob("*.ts").match("main.ts"), builtinModules.includes("fs"), createRequire(import.meta.url)("node:fs").ReadStream === ReadStream);
