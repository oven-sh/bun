// What a bundler writes around a require of a module of the library: members that the program stores or deletes before and after the require.
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
var import_before = require("./before.cjs");
var import_node_fs = __toESM(require("node:fs"));
var import_node_path = __toESM(require("node:path"));
console.log((0, import_node_fs.existsSync)("/"), import_node_fs.default.existsSync("/"), import_node_path.sep, import_node_path.default.sep, (0, import_node_path.basename)("a/b"), import_node_path.default.basename("a/b"));
const real = require("node:fs");
real.statSync = function later() {
  return "stored after the import";
};
require("node:path").extname = () => "extname stored after the import";
console.log((0, import_node_fs.statSync)("/"), import_node_fs.default.statSync("/"), (0, import_node_path.extname)("a.b"), import_node_path.default.extname("a.b"));
delete real.statSync;
console.log(typeof import_node_fs.statSync, typeof import_node_fs.default.statSync);
