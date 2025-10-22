/**
 * Security validation for OpenTelemetry header configuration
 * @module bun-otel/validation
 *
 * This module validates that instrumentation configurations do not attempt to
 * inject or capture sensitive headers that may contain credentials or secrets.
 *
 * Validation happens at SDK level (TypeScript) rather than native level (Zig) to:
 * - Provide better error messages with examples
 * - Allow security policies to evolve without recompiling native code
 * - Validate once at attach() time, not on every request
 * - Ensure consistent validation for all SDK consumers
 */

/**
 * Headers that are explicitly blocked from injection or capture.
 * These headers commonly contain authentication credentials or session tokens.
 */
const BLOCKED_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "www-authenticate",
  "proxy-authenticate",
  "cookie",
  "set-cookie",
  "set-cookie2",
  "x-api-key",
  "api-key",
  "x-auth-token",
  "x-csrf-token",
  "x-xsrf-token",
  "x-amz-security-token",
  "x-goog-iam-authority-selector",
  "x-goog-iam-authorization-token",
]);

/**
 * Patterns that match headers likely to contain sensitive information.
 * Headers matching these patterns will be rejected.
 */
const BLOCKED_PATTERNS = [/^x-secret-/i, /^x-token-/i, /password/i, /secret/i, /apikey/i];

/**
 * Validates that a header name does not match security constraints.
 *
 * @param headerName - The header name to validate
 * @throws {TypeError} If the header is blocked or matches a blocked pattern
 *
 * @example
 * ```typescript
 * validateHeaderName("traceparent"); // OK
 * validateHeaderName("authorization"); // Throws TypeError
 * validateHeaderName("x-secret-key"); // Throws TypeError
 * ```
 */
export function validateHeaderName(headerName: string): void {
  const normalized = headerName.toLowerCase().trim();

  // Check exact matches
  if (BLOCKED_HEADERS.has(normalized)) {
    throw new TypeError(
      `Cannot inject or capture header "${headerName}": ` +
        `This header may contain sensitive credentials. ` +
        `See https://docs.bun.sh/api/telemetry#security for details.`,
    );
  }

  // Check patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(normalized)) {
      throw new TypeError(
        `Cannot inject or capture header "${headerName}": ` +
          `Header name matches blocked pattern ${pattern}. ` +
          `This header may contain sensitive information.`,
      );
    }
  }
}

/**
 * Validates injectHeaders configuration for security constraints.
 *
 * @param config - Header injection configuration
 * @throws {TypeError} If any header name is blocked
 *
 * @example
 * ```typescript
 * // ✅ Valid
 * validateInjectHeaders({
 *   request: ["traceparent", "tracestate"],
 *   response: ["traceparent"]
 * });
 *
 * // ❌ Throws TypeError
 * validateInjectHeaders({
 *   response: ["authorization"]
 * });
 * ```
 */
export function validateInjectHeaders(config: { request?: string[]; response?: string[] }): void {
  if (config.request) {
    for (const header of config.request) {
      validateHeaderName(header);
    }
  }

  if (config.response) {
    for (const header of config.response) {
      validateHeaderName(header);
    }
  }
}

/**
 * Validates captureAttributes configuration for security constraints.
 *
 * @param config - Attribute capture configuration
 * @throws {TypeError} If any header name is blocked
 *
 * @example
 * ```typescript
 * // ✅ Valid
 * validateCaptureAttributes({
 *   requestHeaders: ["user-agent", "accept"],
 *   responseHeaders: ["content-type"]
 * });
 *
 * // ❌ Throws TypeError
 * validateCaptureAttributes({
 *   requestHeaders: ["cookie"]
 * });
 * ```
 */
export function validateCaptureAttributes(config: { requestHeaders?: string[]; responseHeaders?: string[] }): void {
  if (config.requestHeaders) {
    for (const header of config.requestHeaders) {
      validateHeaderName(header);
    }
  }

  if (config.responseHeaders) {
    for (const header of config.responseHeaders) {
      validateHeaderName(header);
    }
  }
}
