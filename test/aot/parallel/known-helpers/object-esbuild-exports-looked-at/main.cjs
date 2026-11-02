// What a bundler writes around the exports of a CommonJS file: descriptors, keys, their order and JSON of the object and of the copy that an importer makes.
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
var lib = __toESM(require("./lib.cjs"));
const textOf = (f) => String(f).replace(/\s+/g, " ");
function describe(object) {
  const lines = [];
  for (const key of Reflect.ownKeys(object)) {
    const d = Object.getOwnPropertyDescriptor(object, key);
    const parts = Object.keys(d).map((name) => `${name}=${typeof d[name] === "function" ? `function ${JSON.stringify(d[name].name)}/${d[name].length}: ${textOf(d[name])}` : typeof d[name] === "object" ? "object" : String(d[name])}`);
    lines.push(`${String(key)}: ${parts.join(" ")}`);
  }
  return lines.join("\n");
}
const required = require("./lib.cjs");
console.log(describe(required));
console.log(describe(lib));
console.log(Object.keys(required).join(), Object.keys(lib).join(), JSON.stringify(required), JSON.stringify(lib));
console.log(Object.getPrototypeOf(required) === Object.prototype, Object.getPrototypeOf(lib) === Object.prototype, Object.isExtensible(required), lib === required);
for (const key in lib) console.log(key, typeof lib[key]);
