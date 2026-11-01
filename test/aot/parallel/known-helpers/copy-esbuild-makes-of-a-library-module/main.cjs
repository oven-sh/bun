// What a bundler writes around a require of a module of the library: its default and its names, read by name.
// COUNT: operation:operationAOTGetOwnPropertyFields <= 20
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
var import_node_fs = __toESM(require("node:fs"));
var import_node_path = __toESM(require("node:path"));
var import_node_os = __toESM(require("node:os"));
var import_node_events = require("node:events");
var import_node_events2 = __toESM(require("node:events"));
var import_node_buffer = require("node:buffer");
var import_node_util = __toESM(require("node:util"));
console.log(typeof import_node_fs.default.readFileSync, (0, import_node_fs.existsSync)("/"), typeof import_node_fs.constants.O_RDONLY, import_node_fs.default.existsSync === import_node_fs.existsSync);
console.log(import_node_path.default.sep, import_node_path.sep, (0, import_node_path.join)("a", "b"), import_node_path.default.join === import_node_path.join, typeof import_node_os.default.EOL);
console.log(import_node_events2.default === import_node_events.EventEmitter, typeof import_node_events2.default.once, new import_node_events.EventEmitter().listenerCount("x"), import_node_buffer.Buffer.from("a").length, import_node_util.default.inspect === import_node_util.inspect, (0, import_node_util.inspect)({ a: 1 }));
