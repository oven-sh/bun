// What a bundler writes around a require of a module of the library: the copy has a getter for each name that the module has when the copy is made, so a name that was deleted ahead of the import stays undefined on the copy when it is stored again.
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
var import_node_path = __toESM(require("node:path"));
var import_node_os = __toESM(require("node:os"));
console.log(import_node_path.sep, (0, import_node_path.basename), typeof import_node_path.join, import_node_os.EOL, typeof import_node_os.default.EOL);
require("node:path").sep = "stored again";
require("node:path").basename = () => "stored again";
require("node:os").EOL = "stored again";
console.log(import_node_path.sep, (0, import_node_path.basename), typeof import_node_path.join, import_node_os.EOL, import_node_os.default.EOL);
