export * from "@opentelemetry/semantic-conventions";

/** TRACEPARENT header */
export const TRACEPARENT = "traceparent";
/** TRACESTATE header */
export const TRACESTATE = "tracestate";

/** WARNING! INCUBATING! - Re-exported from @opentelemetry/semantic-conventions/incubating */
export { ATTR_HTTP_RESPONSE_BODY_SIZE } from "@opentelemetry/semantic-conventions/incubating";

/** Custom incubating attributes not yet in semantic-conventions */
export const ATTR_ERROR_MESSAGE = "error.message";
export const ATTR_ERROR_STACK = "error.stack";
