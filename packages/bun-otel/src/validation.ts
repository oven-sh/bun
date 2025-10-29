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
 * Property name used to mark auto-generated config values.
 * When instrumentations auto-generate headersToSpanAttributes from captureAttributes,
 * they mark it with this property. If setConfig() is later called with new
 * captureAttributes, the migration can detect and discard the stale auto-generated value.
 * Using a string property instead of Symbol because structuredClone doesn't preserve symbols.
 * @internal
 */
export const MIGRATED_MARKER = "__bun_otel_migrated__" as const;

/**
 * Maximum number of headers allowed in configuration lists (per RFC 9110 guidance).
 * Prevents DoS through excessive header processing.
 */
const MAX_HEADERS = 50;

/**
 * RFC 9110 field-name pattern (lowercase only for security consistency).
 * field-name = token = 1*tchar where tchar = "!" / "#" / "$" / "%" / "&" / "'" /
 *              "*" / "+" / "-" / "." / "^" / "_" / "`" / "|" / "~" / DIGIT / ALPHA
 */
const FIELD_NAME_RE = /^[!#$%&'*+.^_`|~0-9a-z-]+$/;

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
 * @throws {TypeError} If the header is blocked, not lowercase, or invalid per RFC 9110
 *
 * @example
 * ```typescript
 * validateHeaderName("traceparent"); // OK
 * validateHeaderName("authorization"); // Throws TypeError - blocked
 * validateHeaderName("x-secret-key"); // Throws TypeError - blocked pattern
 * validateHeaderName("Content-Type"); // Throws TypeError - not lowercase
 * validateHeaderName("invalid header"); // Throws TypeError - invalid RFC 9110 token
 * ```
 */
export function validateHeaderName(headerName: string): void {
  const trimmed = headerName.trim();

  // Enforce lowercase for security consistency
  if (trimmed !== trimmed.toLowerCase()) {
    throw new TypeError(
      `Header names must be lowercase: "${headerName}". ` + `Use lowercase to comply with telemetry security policy.`,
    );
  }

  const normalized = trimmed;

  // Validate RFC 9110 field-name format
  if (!FIELD_NAME_RE.test(normalized)) {
    throw new TypeError(
      `Invalid header name "${headerName}": does not match RFC 9110 field-name. ` +
        `Only alphanumeric and !#$%&'*+-.^_\`|~ characters are allowed.`,
    );
  }

  // Check exact matches against blocked list
  if (BLOCKED_HEADERS.has(normalized)) {
    throw new TypeError(
      `Cannot inject or capture header "${headerName}": ` +
        `This header may contain sensitive credentials. ` +
        `See https://docs.bun.sh/api/telemetry#security for details.`,
    );
  }

  // Check patterns for potentially sensitive headers
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

export function validateOptionalHeaderList(headerList: string[] | undefined, listName: string): number {
  if (headerList) {
    if (headerList.length > MAX_HEADERS) {
      throw new TypeError(`Too many ${listName} (${headerList.length}); max is ${MAX_HEADERS}.`);
    }
    for (const header of headerList) {
      validateHeaderName(header);
    }
    return headerList.length;
  }
  return 0;
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
export function validateInjectHeaders(config: { request?: string[]; response?: string[] }): number {
  return (
    validateOptionalHeaderList(config.request, "request headers") +
    validateOptionalHeaderList(config.response, "response headers")
  );
}

type CaptureAttributes = {
  requestHeaders?: string[];
  responseHeaders?: string[];
};

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
export function validateCaptureAttributes(config?: { requestHeaders?: string[]; responseHeaders?: string[] }): number {
  return (
    validateOptionalHeaderList(config?.requestHeaders, "requestHeaders") +
    validateOptionalHeaderList(config?.responseHeaders, "responseHeaders")
  );
}

type ConfigWithCaptureAttributes = {
  captureAttributes?: CaptureAttributes;
};
function validateConfigCaptureAttributes(config: ConfigWithCaptureAttributes): number {
  return validateCaptureAttributes(config.captureAttributes);
}

type ConfigWithHeadersToSpanAttributes = {
  headersToSpanAttributes?: CaptureAttributes;
};
function validateConfigHeadersToSpanAttributes(config?: ConfigWithHeadersToSpanAttributes): number {
  return validateCaptureAttributes(config?.headersToSpanAttributes);
}
/**
 * Migrates header lists from e.g. headersToSpanAttributes.server or
 * into a unified captureAttributes structure, removing duplicates, validating
 * header names, and ensuring all relevant headers are captured as span attributes.
 *
 *
 * @param config
 * @returns
 */
export function migrateToCaptureAttributes<T extends ConfigWithCaptureAttributes>(
  migrator: (t: T) => CaptureAttributes | undefined,
  prefixer: (header: string) => string = (h: string) => h.toLowerCase().trim(),
): (config: T) => T & { captureAttributes: { requestHeaders: string[]; responseHeaders: string[] } } {
  return (config: T) => {
    // If user provided new captureAttributes and config has auto-generated headersToSpanAttributes,
    // delete the stale auto-generated value to prevent merging
    const configAny = config as any;
    if (config.captureAttributes && configAny.headersToSpanAttributes?.[MIGRATED_MARKER]) {
      // User provided fresh captureAttributes, so discard stale auto-generated headersToSpanAttributes
      const configCopy = { ...config } as any;
      delete configCopy.headersToSpanAttributes;
      // Re-run migration on clean config
      return migrateToCaptureAttributes(migrator, prefixer)(configCopy);
    }

    const requestHeaders = new Set<string>();
    const responseHeaders = new Set<string>();
    const migrated = migrator(config);

    if (migrated) {
      if (migrated.requestHeaders) {
        migrated.requestHeaders.forEach(h => requestHeaders.add(h));
      }
      if (migrated.responseHeaders) {
        migrated.responseHeaders.forEach(h => responseHeaders.add(h));
      }
    }
    if ("captureAttributes" in config) {
      validateConfigCaptureAttributes(config);
      if (config.captureAttributes?.responseHeaders) {
        config.captureAttributes.responseHeaders.forEach(h => responseHeaders.add(h));
      }
      if (config.captureAttributes?.requestHeaders) {
        config.captureAttributes.requestHeaders.forEach(h => requestHeaders.add(h));
      }
    }

    return {
      ...config,
      captureAttributes: {
        requestHeaders: Array.from(requestHeaders).map(prefixer),
        responseHeaders: Array.from(responseHeaders).map(prefixer),
      },
    };
  };
}
