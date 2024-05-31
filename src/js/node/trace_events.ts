// Hardcoded module "node:trace_events"
// This is a stub! This is not actually implemented yet.

const ERR_INVALID_ARG_TYPE = $zig("node_error_binding.zig", "ERR_INVALID_ARG_TYPE");

class Tracing {
  enabled = false;
  categories = "";
}

function createTracing(opts) {
  if (typeof opts !== "object" || opts == null) {
    // @ts-ignore
    throw ERR_INVALID_ARG_TYPE("options", "Object", opts);
  }

  // TODO: validate categories
  // @ts-ignore
  return new Tracing(opts);
}

function getEnabledCategories() {
  return "";
}

export default {
  createTracing,
  getEnabledCategories,
};
