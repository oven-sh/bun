var depd = function(...args) {
  return args.length ? bundle_default(...args) : bundle_default;
};
/*!
 * depd
 * Copyright(c) 2015 Douglas Christopher Wilson
 * MIT Licensed
 */
var { create: __create, defineProperty: __defProp, getOwnPropertyDescriptor: __getOwnPropDesc, getOwnPropertyNames: __getOwnPropNames, getPrototypeOf: __getProtoOf } = Object, __hasOwnProp = Object.prototype.hasOwnProperty, __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
}, __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, {
          get: () => from[key],
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
        });
  }
  return to;
}, __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: !0 }) : target, mod)), require_browser = __commonJS({
  "node_modules/depd/lib/browser/index.js"(exports, module) {
    module.exports = depd2;
    function depd2(namespace) {
      if (!namespace)
        throw new TypeError("argument namespace is required");
      function deprecate(message) {
      }
      return deprecate._file = void 0, deprecate._ignored = !0, deprecate._namespace = namespace, deprecate._traced = !1, deprecate._warned = Object.create(null), deprecate.function = wrapfunction, deprecate.property = wrapproperty, deprecate;
    }
    function wrapfunction(fn, message) {
      if (typeof fn !== "function")
        throw new TypeError("argument fn must be a function");
      return fn;
    }
    function wrapproperty(obj, prop, message) {
      if (!obj || typeof obj !== "object" && typeof obj !== "function")
        throw new TypeError("argument obj must be object");
      var descriptor = Object.getOwnPropertyDescriptor(obj, prop);
      if (!descriptor)
        throw new TypeError("must call property on owner object");
      if (!descriptor.configurable)
        throw new TypeError("property must be configurable");
    }
  }
}), import_depd = __toESM(require_browser()), bundle_default = import_depd.default;
depd[Symbol.for("CommonJS")] = !0;
var depd_default = depd;
export {
  depd_default as default
};

//# debugId=41F0FC7196EF86F564756e2164756e21
