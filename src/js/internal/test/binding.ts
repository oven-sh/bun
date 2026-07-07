// `require('internal/test/binding')` — Node.js-internal testing shim used by
// the vendored node test suite. Resolution is gated like
// `bun:internal-for-testing`: release builds require `--expose-internals`
// (or BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING); debug builds always allow it.
// See HardcodedModule::InternalTestBinding.

const agent = require("internal/trace_events");

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
    default:
      throw new Error(`internalBinding("${name}") is not implemented in Bun`);
  }
}

export default { internalBinding };
