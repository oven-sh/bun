var ERR_INVALID_ARG_TYPE = function(name, type, value) {
  const err = new TypeError(`The "${name}" argument must be of type ${type}. Received ${value}`);
  return err.code = "ERR_INVALID_ARG_TYPE", err;
}, createTracing = function(opts) {
  if (typeof opts !== "object" || opts == null)
    throw new ERR_INVALID_ARG_TYPE("options", "Object", opts);
  return new Tracing(opts);
}, getEnabledCategories = function() {
  return "";
};

class Tracing {
  enabled = !1;
  categories = "";
}
var defaultObject = {
  createTracing,
  getEnabledCategories,
  [Symbol.for("CommonJS")]: 0
};
export {
  getEnabledCategories,
  defaultObject as default,
  createTracing
};
