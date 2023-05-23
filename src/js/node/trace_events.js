// @module "node:trace_events"
// This is a stub! This is not actually implemented yet.

class Tracing {
  enabled = false;
  categories = "";
}

function ERR_INVALID_ARG_TYPE(name, type, value) {
  const err = new TypeError(`The "${name}" argument must be of type ${type}. Received ${value}`);
  err.code = "ERR_INVALID_ARG_TYPE";
  return err;
}

function createTracing(opts) {
  if (typeof opts !== "object" || opts == null) {
    throw new ERR_INVALID_ARG_TYPE("options", "Object", opts);
  }

  // TODO: validate categories
  return new Tracing(opts);
}

function getEnabledCategories() {
  return "";
}

var defaultObject = {
  createTracing,
  getEnabledCategories,
  [Symbol.for("CommonJS")]: 0,
};

export { defaultObject as default, createTracing, getEnabledCategories };
