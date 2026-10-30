// RUN: lower
// OPTIONS: builtin-modules

// What test runners, loggers and tracers do: store a function of their own over a member of a library object, call the original from it, and put it back. process.stdout.write, console.log, a method of EventEmitter.prototype, a function of node:fs as other code of the program sees it, a method of one stream, and Date.now left alone.
import fs from "node:fs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

const captured = [];
const realWrite = process.stdout.write;
process.stdout.write = function (chunk, ...rest) { captured.push(String(chunk)); return true; };
console.log("captured line");
process.stdout.write("captured write\n");
process.stdout.write = realWrite;
console.log(JSON.stringify(captured));

const realLog = console.log;
console.log = (...args) => realLog("[wrapped]", ...args);
console.log("through the wrapper");
console.log = realLog;

const realEmit = EventEmitter.prototype.emit;
const traced = [];
EventEmitter.prototype.emit = function (name, ...args) { traced.push(String(name)); return realEmit.call(this, name, ...args); };
const emitter = new EventEmitter();
emitter.on("ping", () => {});
emitter.emit("ping");
const stream = new PassThrough();
stream.end("x");
stream.resume();
await new Promise(resolve => stream.on("close", resolve));
EventEmitter.prototype.emit = realEmit;
console.log(traced.includes("ping"), traced.includes("finish"), traced.includes("end"));

const realExists = fs.existsSync;
fs.existsSync = path => "replaced for " + path;
console.log(fs.existsSync("/x"), require("node:fs").existsSync("/y"), (await import("node:fs")).default.existsSync("/z"));
fs.existsSync = realExists;
console.log(fs.existsSync("/"));

const one = new PassThrough();
one.write = function (chunk) { return PassThrough.prototype.write.call(this, String(chunk).toUpperCase()); };
one.write("only this stream");
one.end();
console.log((await one.toArray()).join());
