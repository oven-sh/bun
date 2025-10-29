export * from "@opentelemetry/semantic-conventions";
const strip_prefix_of_header = (header: string) =>
  header.startsWith("http.")
    ? header.replace(/http[.](request|response)[.]header[.]/g, "").toLowerCase()
    : header.toLowerCase();
export const ATTR_HTTP_REQUEST_HEADER = (key: string) => `http.request.header.${strip_prefix_of_header(key)}`;
export const ATTR_HTTP_RESPONSE_HEADER = (key: string) => `http.response.header.${strip_prefix_of_header(key)}`;

/** TRACEPARENT header */
export const TRACEPARENT = "traceparent";
export const ATTR_HTTP_REQUEST_HEADER_TRACEPARENT = ATTR_HTTP_REQUEST_HEADER("traceparent");
export const ATTR_HTTP_RESPONSE_HEADER_TRACEPARENT = ATTR_HTTP_RESPONSE_HEADER("traceparent");
/** TRACESTATE header */
export const TRACESTATE = "tracestate";
export const ATTR_HTTP_REQUEST_HEADER_TRACESTATE = ATTR_HTTP_REQUEST_HEADER("tracestate");
export const ATTR_HTTP_RESPONSE_HEADER_TRACESTATE = ATTR_HTTP_RESPONSE_HEADER("tracestate");
/** WARNING! INCUBATING! - Re-exported from @opentelemetry/semantic-conventions/incubating */
export { ATTR_HTTP_RESPONSE_BODY_SIZE } from "@opentelemetry/semantic-conventions/incubating";

/**
 * Exception semantic conventions are re-exported from @opentelemetry/semantic-conventions:
 * - ATTR_EXCEPTION_TYPE = "exception.type"
 * - ATTR_EXCEPTION_MESSAGE = "exception.message"
 * - ATTR_EXCEPTION_STACKTRACE = "exception.stacktrace"
 *
 * Note: ATTR_ERROR_TYPE = "error.type" is DIFFERENT and used for error classification.
 */
