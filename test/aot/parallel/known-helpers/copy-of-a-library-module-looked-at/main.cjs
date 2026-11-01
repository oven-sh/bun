// What a bundler writes around a require of a module of the library: keys and descriptors of the copy.
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
var path = __toESM(require("node:path"));
const real = require("node:path");
const d = Object.getOwnPropertyDescriptor(path, "sep");
console.log(Object.keys(path).join(), Object.keys(d).join(), typeof d.get, d.enumerable, d.configurable, path === real, path.default === real);
console.log(JSON.stringify(Object.getOwnPropertyDescriptor(path, "default"), (k, v) => k === "value" ? typeof v : v), Object.getPrototypeOf(path) === Object.getPrototypeOf(real));
