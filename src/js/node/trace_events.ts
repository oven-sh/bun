// Hardcoded module "node:trace_events"
if (!Bun.isMainThread) {
  throw $ERR_TRACE_EVENTS_UNAVAILABLE("Trace events are unavailable");
}

const agent = require("internal/trace_events");

const ObjectDefineProperty = Object.defineProperty;

const kMaxTracingCount = 10;
// Strong refs: enabled Tracing objects must keep their categories enabled
// even when the user drops every reference (GC must not disable them).
const enabledTracingObjects = new Set<Tracing>();

class Tracing {
  #categories: string[];
  #enabled = false;

  constructor(categories: string[]) {
    this.#categories = categories;
    // `enabled` and `categories` are own enumerable (read-only) properties
    // rather than prototype getters so util.inspect renders instances the way
    // node does: `[Tracing]` at the depth cut and
    // `Tracing { enabled: false, categories: '...' }` otherwise.
    setOwnProperty(this, "enabled", false);
    setOwnProperty(this, "categories", categories.join(","));
  }

  enable() {
    if (this.#enabled) return;
    this.#enabled = true;
    setOwnProperty(this, "enabled", true);
    agent.enableCategories(this.#categories);
    enabledTracingObjects.$add(this);
    if (enabledTracingObjects.size > kMaxTracingCount) {
      process.emitWarning(
        "Possible trace_events memory leak detected. There are more than " +
          `${kMaxTracingCount} enabled Tracing objects.`,
      );
    }
  }

  disable() {
    if (!this.#enabled) return;
    this.#enabled = false;
    setOwnProperty(this, "enabled", false);
    agent.disableCategories(this.#categories);
    enabledTracingObjects.$delete(this);
  }
}

function setOwnProperty(tracing: Tracing, name: string, value: boolean | string): void {
  ObjectDefineProperty(tracing, name, {
    value,
    writable: false,
    enumerable: true,
    configurable: true,
  });
}

function createTracing(options: { categories: string[] }): Tracing {
  if (typeof options !== "object" || options === null) {
    throw $ERR_INVALID_ARG_TYPE("options", "object", options);
  }
  const categories = options.categories;
  if (!$isArray(categories)) {
    throw $ERR_INVALID_ARG_TYPE("options.categories", "string[]", categories);
  }
  if (categories.length === 0) {
    throw $ERR_TRACE_EVENTS_CATEGORY_REQUIRED("At least one category is required");
  }
  for (const category of categories) {
    if (typeof category !== "string") {
      throw $ERR_INVALID_ARG_TYPE("options.categories", "string[]", category);
    }
  }
  return new Tracing(categories.slice());
}

function getEnabledCategories(): string | undefined {
  return agent.getEnabledCategories();
}

export default {
  createTracing,
  getEnabledCategories,
};
