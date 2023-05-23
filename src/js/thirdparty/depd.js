// @module "depd"
// TODO: remove this module from being bundled into bun
// This is a temporary workaround for a CommonJS <> ESM interop issue.

/*!
 * depd
 * Copyright(c) 2015 Douglas Christopher Wilson
 * MIT Licensed
 */

var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) =>
  function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
var __copyProps = (to, from, except, desc) => {
  if ((from && typeof from === "object") || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, {
          get: () => from[key],
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable,
        });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (
  (target = mod != null ? __create(__getProtoOf(mod)) : {}),
  __copyProps(
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod,
  )
);

// node_modules/depd/lib/browser/index.js
var require_browser = __commonJS({
  "node_modules/depd/lib/browser/index.js"(exports, module) {
    "use strict";
    module.exports = depd2;
    function depd2(namespace) {
      if (!namespace) {
        throw new TypeError("argument namespace is required");
      }
      function deprecate(message) {}
      deprecate._file = void 0;
      deprecate._ignored = true;
      deprecate._namespace = namespace;
      deprecate._traced = false;
      deprecate._warned = /* @__PURE__ */ Object.create(null);
      deprecate.function = wrapfunction;
      deprecate.property = wrapproperty;
      return deprecate;
    }
    function wrapfunction(fn, message) {
      if (typeof fn !== "function") {
        throw new TypeError("argument fn must be a function");
      }
      return fn;
    }
    function wrapproperty(obj, prop, message) {
      if (!obj || (typeof obj !== "object" && typeof obj !== "function")) {
        throw new TypeError("argument obj must be object");
      }
      var descriptor = Object.getOwnPropertyDescriptor(obj, prop);
      if (!descriptor) {
        throw new TypeError("must call property on owner object");
      }
      if (!descriptor.configurable) {
        throw new TypeError("property must be configurable");
      }
    }
  },
});

// bundle.js
var import_depd = __toESM(require_browser());
var bundle_default = import_depd.default;

function depd(...args) {
  return args.length ? bundle_default(...args) : bundle_default;
}
depd[Symbol.for("CommonJS")] = true; // TODO: this requires hacky default export

export default depd;
