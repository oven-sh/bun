// What esbuild writes around a require of a module of the library: what the helper makes shows each name that the module has at that moment, reads it on the module whenever it is asked, and is `this` of what is called through it.
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
require("./before.cjs");
try {
  early();
} catch (error) {
  console.log(error.constructor.name, error.message.split(" (")[0]);
}
const path = __toESM(require("node:path"));
const os = __toESM(require("node:os"));
const util = __toESM(require("node:util"));
const events = __toESM(require("node:events"));
const real = require("node:path");
function early() {
  return path.join("a", "b");
}
function whoIsThis() {
  return this === path ? "what the helper made" : this === real ? "the module" : this === os ? "os" : typeof this;
}
function inTailPosition(name) {
  "use strict";
  return path.basename(name);
}
function show() {
  console.log(early(), path.isAbsolute("/a"), (0, path.isAbsolute)("a"), typeof path.extname, typeof path.dirname, path.sep, globalThis.readsOfSep);
  console.log(path.join(...["a", "b"], "c"), path.join?.("a", "b"), path.nothing?.("a"), inTailPosition("a/b"), path.normalize("a//b").length);
}
show();
console.log(os === require("node:os"), typeof os.EOL, typeof os.platform(), util.format("%s", 1), typeof util.inspect, globalThis.readsOfMarker);
console.log(typeof events.EventEmitter, typeof events.once, new events.EventEmitter().listenerCount("x"), events.listenerCount(new events.EventEmitter(), "x"));
real.extname = () => "stored behind the import";
real.dirname = () => "stored behind the import";
real.join = whoIsThis;
real.isAbsolute = whoIsThis;
real.basename = whoIsThis;
require("node:os").platform = whoIsThis;
show();
console.log(os.platform(), (0, os.platform)());
delete real.normalize;
try {
  show();
} catch (error) {
  console.log(error.constructor.name, error.message.split(" (")[0]);
}
try {
  path.delimiter();
} catch (error) {
  console.log(error.constructor.name, error.message.split(" (")[0]);
}
real.resolve = function whereAmI() {
  return new Error("here").stack.split("\n").slice(0, 3).join(" | ").replaceAll(__dirname, "");
};
console.log(path.resolve());
function importLate() {
  const url = __toESM(require("node:url"));
  return [typeof url.parse, typeof url.format, typeof url.resolve].join(" ");
}
console.log(importLate());
delete require("node:url").format;
console.log(importLate());
require("node:url").format = "stored again";
require("node:url").__esModule = true;
console.log(importLate());
