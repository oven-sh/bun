# SDK Security Validation

**Location**: `packages/bun-otel/` (TypeScript SDK wrapping `Bun.telemetry` native API)
**Purpose**: Prevent header injection attacks and credential leakage
**Layer**: Application layer (TypeScript), NOT native layer (Zig)

## Architecture Decision

Security validation is performed at the **SDK level** (TypeScript) rather than native level (Zig) because:

1. **Better Error Messages**: SDK can provide detailed, user-friendly error messages with examples
2. **Easier Maintenance**: Security policies can evolve without recompiling native code
3. **Performance**: Validation happens once at `attach()` time, not on every request
4. **Consistency**: Same validation logic for all consumers of the SDK

## Blocked Headers

The SDK **MUST** reject these headers in `injectHeaders` and `captureAttributes`:

### Authentication & Authorization
- `authorization`
- `proxy-authorization`
- `www-authenticate`
- `proxy-authenticate`

### Session Management
- `cookie`
- `set-cookie`
- `set-cookie2` (deprecated but still blocked)

### API Keys & Tokens
- `x-api-key`
- `api-key`
- `x-auth-token`
- `x-csrf-token`
- `x-xsrf-token`

### Cloud Provider Credentials
- `x-amz-security-token` (AWS)
- `x-goog-iam-authority-selector` (Google Cloud)
- `x-goog-iam-authorization-token` (Google Cloud)

### Custom Security Headers
- Headers starting with `x-secret-`
- Headers starting with `x-token-`
- Headers containing `password` (case-insensitive)
- Headers containing `secret` (case-insensitive)
- Headers containing `apikey` (case-insensitive)

## Implementation Pattern

```typescript
// packages/bun-otel/src/validation.ts

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

const BLOCKED_PATTERNS = [
  /^x-secret-/i,
  /^x-token-/i,
  /password/i,
  /secret/i,
  /apikey/i,
];

export function validateHeaderName(headerName: string): void {
  const normalized = headerName.toLowerCase().trim();

  // Check exact matches
  if (BLOCKED_HEADERS.has(normalized)) {
    throw new TypeError(
      `Cannot inject or capture header "${headerName}": ` +
      `This header may contain sensitive credentials. ` +
      `See https://docs.bun.sh/api/telemetry#security for details.`
    );
  }

  // Check patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(normalized)) {
      throw new TypeError(
        `Cannot inject or capture header "${headerName}": ` +
        `Header name matches blocked pattern ${pattern}. ` +
        `This header may contain sensitive information.`
      );
    }
  }
}

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
```

## SDK Wrapper Example

```typescript
// packages/bun-otel/src/instrumentation.ts

import { validateInjectHeaders, validateCaptureAttributes } from "./validation";

export interface InstrumentConfig {
  type: InstrumentKind;
  name: string;
  version: string;
  injectHeaders?: {
    request?: string[];
    response?: string[];
  };
  captureAttributes?: {
    requestHeaders?: string[];
    responseHeaders?: string[];
  };
  // ... hooks
}

export function attach(config: InstrumentConfig): number {
  // Validate security constraints BEFORE calling native API
  if (config.injectHeaders) {
    validateInjectHeaders(config.injectHeaders);
  }

  if (config.captureAttributes) {
    validateCaptureAttributes(config.captureAttributes);
  }

  // Call native API (no security validation in Zig)
  return Bun.telemetry.attach(config);
}
```

## User-Facing Documentation

The SDK should document the security constraints prominently:

```markdown
### Security Constraints

For security reasons, the following headers **cannot** be injected or captured:

- Authentication headers (`authorization`, `cookie`, etc.)
- API keys (`x-api-key`, `api-key`, etc.)
- Cloud provider credentials (AWS, GCP tokens)
- Any header containing `secret`, `password`, or `apikey`

**Why?** These headers may contain sensitive credentials that should never be
logged, traced, or transmitted to external systems. Attempting to configure these
headers will throw a `TypeError` at instrumentation registration time.

**Example:**

```typescript
// ❌ This will throw a TypeError
Bun.telemetry.attach({
  type: InstrumentKind.HTTP,
  injectHeaders: {
    response: ["authorization"] // ERROR: Blocked header
  }
});

// ✅ This is allowed
Bun.telemetry.attach({
  type: InstrumentKind.HTTP,
  injectHeaders: {
    response: ["traceparent", "tracestate"] // Safe distributed tracing headers
  }
});
```
```

## Testing Strategy

SDK tests should validate that:

1. All blocked headers throw `TypeError` on `attach()`
2. Blocked patterns (e.g., `x-secret-*`) are rejected
3. Case-insensitive matching works (`Authorization` === `authorization`)
4. Whitespace is trimmed before validation
5. Safe headers like `traceparent`, `tracestate`, `x-request-id` are allowed

See: `test/js/bun/telemetry/security-validation.test.ts` for test examples.

## Future Enhancements

1. **Allowlist Mode**: Option to only allow specific headers (deny-by-default)
2. **Custom Blocklists**: Per-organization header blocklists via configuration
3. **Audit Logging**: Log attempts to configure blocked headers for security monitoring
4. **Runtime Warnings**: Warn (but don't block) for headers matching suspicious patterns
