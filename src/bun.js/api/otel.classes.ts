import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "OtelSpanContext",
    construct: false,
    noConstructor: true,
    finalize: true,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
    proto: {
      traceId: { getter: "getTraceId", cache: true },
      spanId: { getter: "getSpanId", cache: true },
      traceFlags: { getter: "getTraceFlags" },
      isRemote: { getter: "getIsRemote" },
      toTraceparent: { fn: "toTraceparent", length: 0 },
    },
  }),

  define({
    name: "OtelSpan",
    construct: false,
    noConstructor: true,
    finalize: true,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
    values: ["savedSlot"],
    proto: {
      spanContext: { getter: "getSpanContext", cache: true },
      isRecording: { getter: "getIsRecording" },
      set: { fn: "set", length: 1 },
      event: { fn: "event", length: 1 },
      ok: { fn: "ok", length: 0 },
      error: { fn: "setError", length: 1 },
      updateName: { fn: "updateName", length: 1 },
      end: { fn: "end", length: 0 },
      "@@dispose": { fn: "dispose", length: 0 },
      "@@asyncDispose": { fn: "dispose", length: 0 },
    },
  }),

  define({
    name: "OtelTracer",
    construct: false,
    noConstructor: true,
    finalize: true,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
    proto: {
      start: { fn: "start", length: 1 },
    },
  }),
];
