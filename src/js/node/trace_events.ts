// Hardcoded module "node:trace_events"
const { validateObject, validateString } = require("internal/validators");

// Native bindings for trace events
const { enableTraceEvents, disableTraceEvents, emitTraceEvent } = $cpp(
  "NodeTraceEvents.cpp",
  "createNodeTraceEventsBindings",
);

// Trace event categories that were enabled via CLI
let globalCategories = "";

// Initialize trace events if enabled via CLI
const trace_categories = Bun.env.NODE_TRACE_EVENT_CATEGORIES;
if (trace_categories) {
  globalCategories = trace_categories;
  enableTraceEvents(globalCategories);

  // Emit initial environment trace event
  emitTraceEvent("Environment", "node.environment");
}

function Tracing(options) {
  validateObject(options, "options");

  let categories = "";
  if (options.categories !== undefined) {
    if (Array.isArray(options.categories)) {
      categories = options.categories.join(",");
    } else {
      validateString(options.categories, "options.categories");
      categories = options.categories || "";
    }
  }

  let enabled = false;

  return {
    get enabled() {
      return enabled;
    },

    get categories() {
      return categories;
    },

    enable() {
      if (enabled) return;
      enabled = true;
      enableTraceEvents(categories);
    },

    disable() {
      if (!enabled) return;
      enabled = false;
      disableTraceEvents();
    },
  };
}

function createTracing(options) {
  return Tracing(options);
}

function getEnabledCategories() {
  // Return categories that were enabled via command line
  return globalCategories;
}

export default {
  createTracing,
  getEnabledCategories,
};
