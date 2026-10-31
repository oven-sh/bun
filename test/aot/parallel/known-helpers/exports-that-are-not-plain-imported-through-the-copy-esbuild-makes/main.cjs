// What esbuild writes around a require, of exports that another file has changed ahead of the import: a marker that is a getter and answers otherwise the second time, takes itself away, takes names away or changes what stands above the exports; exports below a proxy, whose traps are listed; a marker with a value; names that are fixed, frozen, accessors or hidden from a walk.
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
const log = (globalThis.log = []);
require("./before.cjs");
const changes = __toESM(require("./changes.cjs"));
const removes_itself = __toESM(require("./removes-itself.cjs"));
const removes_names = __toESM(require("./removes-names.cjs"));
const changes_what_is_above = __toESM(require("./changes-what-is-above.cjs"));
const below_a_proxy = __toESM(require("./below-a-proxy.cjs"));
const marked_zero = __toESM(require("./marked-zero.cjs"));
const marked_true = __toESM(require("./marked-true.cjs"));
const fixed = __toESM(require("./fixed.cjs"));
const frozen = __toESM(require("./frozen.cjs"));
const accessor = __toESM(require("./accessor.cjs"));
const hidden = __toESM(require("./hidden.cjs"));
const untouched = __toESM(require("./untouched.cjs"));
function show() {
  console.log("changes:", changes.value, changes.other, changes.who(), (0, changes.who)(), typeof changes.default, changes.inherited, log.splice(0).join(", "));
  console.log("removes-itself:", removes_itself.value, removes_itself.other, removes_itself.who(), (0, removes_itself.who)(), typeof removes_itself.default, removes_itself.inherited, log.splice(0).join(", "));
  console.log("removes-names:", removes_names.value, removes_names.other, removes_names.who(), (0, removes_names.who)(), typeof removes_names.default, removes_names.inherited, log.splice(0).join(", "));
  console.log("changes-what-is-above:", changes_what_is_above.value, changes_what_is_above.other, changes_what_is_above.who(), (0, changes_what_is_above.who)(), typeof changes_what_is_above.default, changes_what_is_above.inherited, log.splice(0).join(", "));
  console.log("below-a-proxy:", below_a_proxy.value, below_a_proxy.other, below_a_proxy.who(), (0, below_a_proxy.who)(), typeof below_a_proxy.default, below_a_proxy.inherited, log.splice(0).join(", "));
  console.log("marked-zero:", marked_zero.value, marked_zero.other, marked_zero.who(), (0, marked_zero.who)(), typeof marked_zero.default, marked_zero.inherited, log.splice(0).join(", "));
  console.log("marked-true:", marked_true.value, marked_true.other, marked_true.who(), (0, marked_true.who)(), typeof marked_true.default, marked_true.inherited, log.splice(0).join(", "));
  console.log("fixed:", fixed.value, fixed.other, fixed.who(), (0, fixed.who)(), typeof fixed.default, fixed.inherited, log.splice(0).join(", "));
  console.log("frozen:", frozen.value, frozen.other, frozen.who(), (0, frozen.who)(), typeof frozen.default, frozen.inherited, log.splice(0).join(", "));
  console.log("accessor:", accessor.value, accessor.other, accessor.who(), (0, accessor.who)(), typeof accessor.default, accessor.inherited, log.splice(0).join(", "));
  console.log("hidden:", hidden.value, hidden.other, hidden.who(), (0, hidden.who)(), typeof hidden.default, hidden.inherited, log.splice(0).join(", "));
  console.log("untouched:", untouched.value, untouched.other, untouched.who(), (0, untouched.who)(), typeof untouched.default, untouched.inherited, log.splice(0).join(", "));
}
show();
for (const name of ["changes", "removes-itself", "removes-names", "changes-what-is-above", "below-a-proxy", "marked-zero", "marked-true", "fixed", "frozen", "accessor", "hidden", "untouched"]) {
  const real = require("./" + name + ".cjs");
  for (const change of [() => (real.value = "stored behind the import"), () => delete real.other, () => (real.other = "stored again"), () => (real.who = function () { return this === real ? "the exports, by another function" : "another object, by another function"; })]) {
    try {
      change();
    } catch (error) {
      log.push(error.constructor.name);
    }
  }
}
show();
