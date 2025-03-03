// Hardcoded module "node:trace_events"
// This is a stub! This is not actually implemented yet.
class Tracing {
  enabled = false;
  categories = "";
}

function createTracing(opts) {
  if (typeof opts !== "object" || opts == null) {
    // @ts-ignore
    throw $ERR_INVALID_ARG_TYPE("options", "object", opts);
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
