// What a bundler writes around a require: the default of files with the marker, without it, with a false one, and of files that export no object.
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
var import_function = __toESM(require("./function.cjs"));
var import_object = __toESM(require("./object.cjs"));
var import_marked_by_hand = __toESM(require("./marked-by-hand.cjs"));
var import_marked_false = __toESM(require("./marked-false.cjs"));
var import_marked_without_default = __toESM(require("./marked-without-default.cjs"));
var import_value_null = __toESM(require("./value-null.cjs"));
var import_value_undefined = __toESM(require("./value-undefined.cjs"));
var import_value_5 = __toESM(require("./value-5.cjs"));
var import_value_text = __toESM(require("./value-text.cjs"));
var import_value_false = __toESM(require("./value-false.cjs"));
console.log((0, import_function.default)(1), import_function.default.member, JSON.stringify(import_object.default), import_marked_by_hand.default, JSON.stringify(import_marked_false.default), import_marked_without_default.default, import_value_null.default, import_value_undefined.default, import_value_5.default, import_value_text.default, import_value_false.default);
