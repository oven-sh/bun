// src/js/node/trace_events.js
var ERR_INVALID_ARG_TYPE = function(name, type, value) {
  const err = new TypeError(`The "${name}" argument must be of type ${type}. Received ${value}`);
  err.code = "ERR_INVALID_ARG_TYPE";
  return err;
};
var createTracing = function(opts) {
  if (typeof opts !== "object" || opts == null) {
    throw new ERR_INVALID_ARG_TYPE("options", "Object", opts);
  }
  return new Tracing(opts);
};
var getEnabledCategories = function() {
  return "";
};

class Tracing {
  enabled = false;
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

//# debugId=9775D272F7710BAE64756e2164756e21
