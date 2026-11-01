// What esbuild writes around a require of a CommonJS file without the marker: an object with names, a function with names, and a proxy, whose traps run as often as the helper and the reads ask it.
"use strict";
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
const names = __toESM(require("./names.cjs"));
const whole = __toESM(require("./whole.cjs"));
const trapped = __toESM(require("./trapped.cjs"));
function show() {
  console.log(names.who() === names, (0, names.who)() === undefined, names.count, names.lost, names.hidden, typeof names.default);
  console.log(whole.who() === whole, whole.count, typeof whole.default, whole.default.who() === whole.default, whole.name, whole.length);
  console.log(trapped.who() === trapped, trapped.count, globalThis.traps.join(", "));
}
show();
require("./names.cjs").lost = "stored behind the import";
require("./names.cjs").count++;
require("./whole.cjs").count++;
require("./names.cjs").who = function other() {
  "use strict";
  return this === names ? names : "other";
};
show();
