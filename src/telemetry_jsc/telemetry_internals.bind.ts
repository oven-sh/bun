import * as b from "../codegen/bindgen-lib.ts";
import { Span } from "./telemetry.bind.ts";

export default b.module({ rustPath: "crate::api" });

const heap = { capability: "heap", throws: true } as const;
const js = { capability: "js", throws: true } as const;
const madeByNativeCode = { feature: "Telemetry", ...js } as const;
const forwarded = { args: { args: b.any.variadic }, returns: b.any, passThis: true, passCallee: true } as const;

/** What `Bun.otel.wrap()` and `contextManager.bind()` return. */
export const callWrapped = b.fn({ ...forwarded, ...madeByNativeCode, export: "Bun__Telemetry__callWrapped" });
export const callBound = b.fn({ ...forwarded, ...madeByNativeCode, export: "Bun__Telemetry__callBound" });

const endsSpan = { args: { value: b.any, span: Span.withValue }, feature: "Telemetry", capability: "heap" } as const;
export const onResolve = b.fn({ ...endsSpan, export: "Bun__Telemetry__onResolve" });
export const onReject = b.fn({ ...endsSpan, export: "Bun__Telemetry__onReject" });

const settlesExport = { args: { value: b.any, ticket: b.f64 }, feature: "Telemetry" } as const;
export const onExportResolve = b.fn({ ...settlesExport, export: "Bun__Telemetry__onExportResolve" });
export const onExportReject = b.fn({ ...settlesExport, capability: "heap", export: "Bun__Telemetry__onExportReject" });

/** For node:http, whose client is written in JavaScript. */
export const httpClientEnabled = b.fn({
  returns: b.bool,
  rustPath: "crate::http_client::node_enabled",
  capability: "heap",
});
export const httpClientBegin = b.fn({
  args: { traceparent: b.string.utf8.otherAsNull, tracestate: b.string.utf8.otherAsNull, hasBaggage: b.bool },
  returns: b.any.returning("Array", "undefined"),
  rustPath: "crate::http_client::node_begin",
  ...heap,
});
export const httpClientEnd = b.fn({
  args: {
    span: Span.withValue,
    method: b.string.utf8,
    url: b.string.utf8,
    status: b.f64.otherAsNull,
    httpVersion: b.string.utf8.otherAsNull,
    error: b.any,
  },
  rustPath: "crate::http_client::node_end",
  capability: "heap",
});
