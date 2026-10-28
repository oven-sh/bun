// Prints the name, the length and the text of functions of Buffer, Bun, console, process and node:module. Each is taken out of its holder by a pattern.
const show = (label, fn) =>
  console.log(label, JSON.stringify([fn.name, fn.length, Reflect.ownKeys(fn).map(String), String(fn)]));

const { alloc, from, isBuffer } = Buffer;
const { toJSON, write: writeBytes } = Buffer.prototype;
const { file, peek, Glob } = Bun;
const { status } = peek;
const { match, scan, scanSync } = Glob.prototype;
const { log, write, [Symbol.asyncIterator]: lines } = console;
const { cwd, loadEnvFile, _rawDebug } = process;
const { _initPaths } = require("node:module");

show("alloc", alloc);
show("from", from);
show("isBuffer", isBuffer);
show("toJSON", toJSON);
show("writeBytes", writeBytes);
show("file", file);
show("peek", peek);
show("status", status);
show("match", match);
show("scan", scan);
show("scanSync", scanSync);
show("log", log);
show("write", write);
show("lines", lines);
show("cwd", cwd);
show("loadEnvFile", loadEnvFile);
show("_rawDebug", _rawDebug);
show("_initPaths", _initPaths);
