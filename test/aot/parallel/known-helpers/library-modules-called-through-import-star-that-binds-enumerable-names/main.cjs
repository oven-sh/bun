// What TypeScript 4.0 to 5.6 writes around a require of a module of the library: what the helper makes shows each name that the module has at that moment, reads it on the module whenever it is asked, and is `this` of what is called through it.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
require("./before.cjs");
try {
  early();
} catch (error) {
  console.log(error.constructor.name, error.message.split(" (")[0]);
}
const path = __importStar(require("node:path"));
const os = __importStar(require("node:os"));
const util = __importStar(require("node:util"));
const events = __importStar(require("node:events"));
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
  const url = __importStar(require("node:url"));
  return [typeof url.parse, typeof url.format, typeof url.resolve].join(" ");
}
console.log(importLate());
delete require("node:url").format;
console.log(importLate());
require("node:url").format = "stored again";
require("node:url").__esModule = true;
console.log(importLate());
