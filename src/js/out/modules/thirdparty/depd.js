var depd2 = function(namespace) {
  if (!namespace)
    throw new TypeError("argument namespace is required");
  function deprecate(message) {
  }
  return deprecate._file = void 0, deprecate._ignored = !0, deprecate._namespace = namespace, deprecate._traced = !1, deprecate._warned = Object.create(null), deprecate.function = wrapfunction, deprecate.property = wrapproperty, deprecate;
}, wrapfunction = function(fn, message) {
  if (typeof fn !== "function")
    throw new TypeError("argument fn must be a function");
  return fn;
}, wrapproperty = function(obj, prop, message) {
  if (!obj || typeof obj !== "object" && typeof obj !== "function")
    throw new TypeError("argument obj must be object");
  var descriptor = Object.getOwnPropertyDescriptor(obj, prop);
  if (!descriptor)
    throw new TypeError("must call property on owner object");
  if (!descriptor.configurable)
    throw new TypeError("property must be configurable");
}, depd_default = depd2;
depd2[Symbol.for("CommonJS")] = 0;
export {
  depd_default as default
};
