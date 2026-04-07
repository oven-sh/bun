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
    proto: {
      spanContext: { getter: "getSpanContext", cache: true },
      isRecording: { getter: "getIsRecording" },
      setAttribute: { fn: "setAttribute", length: 2 },
      setAttributes: { fn: "setAttributes", length: 1 },
      addEvent: { fn: "addEvent", length: 1 },
      setStatus: { fn: "setStatus", length: 1 },
      updateName: { fn: "updateName", length: 1 },
      end: { fn: "end", length: 0 },
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
      startSpan: { fn: "startSpan", length: 1 },
      startActiveSpan: { fn: "startActiveSpan", length: 2 },
    },
  }),
];
