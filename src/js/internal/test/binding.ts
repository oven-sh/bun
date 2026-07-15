// `require('internal/test/binding')` — Node.js-internal testing shim used by
// the vendored node test suite. Resolution is gated like
// `bun:internal-for-testing`: release builds require `--expose-internals`
// (or BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING); debug builds always allow it.
// See HardcodedModule::InternalTestBinding.

const clusterRawBind = $newRustFunction("node_cluster_binding.rs", "clusterRawBind", 4);

const agent = require("internal/trace_events");

let fs;

class UDP {
  fd = -1;

  bind(address, port, flags) {
    return bindInternal(this, address, port, flags, "udp4");
  }

  bind6(address, port, flags) {
    return bindInternal(this, address, port, flags, "udp6");
  }

  close() {
    if (this.fd >= 0) {
      fs ??= require("node:fs");
      try {
        fs.closeSync(this.fd);
      } catch {}
      this.fd = -1;
    }
  }
}

function bindInternal(self, address, port, flags, type) {
  const rval = clusterRawBind(type, address, port | 0, flags | 0);
  if (typeof rval === "number") return rval;
  self.fd = rval.fd;
  return 0;
}

function internalBinding(name: string) {
  switch (name) {
    case "trace_events":
      return {
        trace: agent.trace,
        isTraceCategoryEnabled: agent.isTraceCategoryEnabled,
        getCategoryEnabledBuffer: agent.getCategoryEnabledBuffer,
      };
    case "constants":
      return {
        trace: {
          TRACE_EVENT_PHASE_NESTABLE_ASYNC_BEGIN: 98,
          TRACE_EVENT_PHASE_NESTABLE_ASYNC_END: 101,
        },
      };
    case "udp_wrap":
      return { UDP };
    default:
      throw new Error(`internalBinding("${name}") is not implemented in Bun`);
  }
}

export default { internalBinding };
