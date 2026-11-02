// What a bundler writes around the exports of a CommonJS file and around a require: names that are only read by name.
// COUNT: operation:operationAOTDefineOwnProperty = 0
// COUNT: operation:operationAOTGetOwnPropertyFields = 0
// COUNT: operation:operationAOTOwnPropertyKeys = 0
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
var import_lib = __toESM(require("./lib.cjs"));
let sum = 0;
for (let i = 0; i < 1e3; i++) sum += (0, import_lib.twice)(i) + import_lib.seven;
console.log(sum, (0, import_lib.default)(), new import_lib.Point(3).x, import_lib.list.join(), typeof import_lib.twice, import_lib.twice.name, import_lib.default.name);
