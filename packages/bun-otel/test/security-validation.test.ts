/**
 * Security validation tests for bun-otel SDK
 * Tests that blocked headers are rejected at SDK level before reaching native code
 */
import { describe, expect, test } from "bun:test";
import { validateCaptureAttributes, validateHeaderName, validateInjectHeaders } from "../src/validation";

describe("validateHeaderName()", () => {
  describe("blocked headers (exact match)", () => {
    const blockedHeaders = [
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
    ];

    blockedHeaders.forEach(header => {
      test(`blocks "${header}"`, () => {
        expect(() => validateHeaderName(header)).toThrow(TypeError);
        expect(() => validateHeaderName(header)).toThrow(/sensitive credentials/i);
      });
    });

    test("case-insensitive matching", () => {
      expect(() => validateHeaderName("Authorization")).toThrow(TypeError);
      expect(() => validateHeaderName("COOKIE")).toThrow(TypeError);
      expect(() => validateHeaderName("Set-Cookie")).toThrow(TypeError);
      expect(() => validateHeaderName("X-API-KEY")).toThrow(TypeError);
    });

    test("trims whitespace before validation", () => {
      expect(() => validateHeaderName("  authorization  ")).toThrow(TypeError);
      expect(() => validateHeaderName("\tcookie\t")).toThrow(TypeError);
      expect(() => validateHeaderName(" set-cookie ")).toThrow(TypeError);
    });
  });

  describe("blocked patterns", () => {
    test('blocks headers starting with "x-secret-"', () => {
      expect(() => validateHeaderName("x-secret-key")).toThrow(TypeError);
      expect(() => validateHeaderName("x-secret-token")).toThrow(TypeError);
      expect(() => validateHeaderName("X-SECRET-API-KEY")).toThrow(TypeError);
      expect(() => validateHeaderName("x-secret-")).toThrow(TypeError);
    });

    test('blocks headers starting with "x-token-"', () => {
      expect(() => validateHeaderName("x-token-value")).toThrow(TypeError);
      expect(() => validateHeaderName("X-TOKEN-AUTH")).toThrow(TypeError);
      expect(() => validateHeaderName("x-token-")).toThrow(TypeError);
    });

    test('blocks headers containing "password"', () => {
      expect(() => validateHeaderName("password")).toThrow(TypeError);
      expect(() => validateHeaderName("x-password")).toThrow(TypeError);
      expect(() => validateHeaderName("user-password")).toThrow(TypeError);
      expect(() => validateHeaderName("PASSWORD")).toThrow(TypeError);
    });

    test('blocks headers containing "secret"', () => {
      expect(() => validateHeaderName("secret")).toThrow(TypeError);
      expect(() => validateHeaderName("x-secret")).toThrow(TypeError);
      expect(() => validateHeaderName("client-secret")).toThrow(TypeError);
      expect(() => validateHeaderName("SECRET-KEY")).toThrow(TypeError);
    });

    test('blocks headers containing "apikey"', () => {
      expect(() => validateHeaderName("apikey")).toThrow(TypeError);
      expect(() => validateHeaderName("x-apikey")).toThrow(TypeError);
      expect(() => validateHeaderName("client-apikey")).toThrow(TypeError);
      expect(() => validateHeaderName("APIKEY")).toThrow(TypeError);
    });

    test("pattern matches provide specific error message", () => {
      expect(() => validateHeaderName("x-secret-key")).toThrow(/blocked pattern/i);
      expect(() => validateHeaderName("x-token-auth")).toThrow(/blocked pattern/i);
    });
  });

  describe("allowed headers", () => {
    const allowedHeaders = [
      "traceparent",
      "tracestate",
      "x-request-id",
      "x-correlation-id",
      "x-trace-id",
      "x-span-id",
      "user-agent",
      "accept",
      "content-type",
      "content-length",
      "host",
      "referer",
      "x-forwarded-for",
      "x-real-ip",
      "x-custom-header",
    ];

    allowedHeaders.forEach(header => {
      test(`allows "${header}"`, () => {
        expect(() => validateHeaderName(header)).not.toThrow();
      });
    });

    test("allows headers in different cases", () => {
      expect(() => validateHeaderName("TraceParent")).not.toThrow();
      expect(() => validateHeaderName("TRACEPARENT")).not.toThrow();
      expect(() => validateHeaderName("X-Request-ID")).not.toThrow();
    });
  });
});

describe("validateInjectHeaders()", () => {
  test("validates request headers", () => {
    expect(() => {
      validateInjectHeaders({
        request: ["traceparent", "tracestate"],
      });
    }).not.toThrow();

    expect(() => {
      validateInjectHeaders({
        request: ["authorization"],
      });
    }).toThrow(TypeError);
  });

  test("validates response headers", () => {
    expect(() => {
      validateInjectHeaders({
        response: ["traceparent", "x-trace-id"],
      });
    }).not.toThrow();

    expect(() => {
      validateInjectHeaders({
        response: ["set-cookie"],
      });
    }).toThrow(TypeError);
  });

  test("validates both request and response headers", () => {
    expect(() => {
      validateInjectHeaders({
        request: ["traceparent"],
        response: ["traceparent"],
      });
    }).not.toThrow();

    expect(() => {
      validateInjectHeaders({
        request: ["traceparent"],
        response: ["cookie"],
      });
    }).toThrow(TypeError);

    expect(() => {
      validateInjectHeaders({
        request: ["authorization"],
        response: ["traceparent"],
      });
    }).toThrow(TypeError);
  });

  test("handles empty arrays", () => {
    expect(() => {
      validateInjectHeaders({
        request: [],
        response: [],
      });
    }).not.toThrow();
  });

  test("handles undefined properties", () => {
    expect(() => {
      validateInjectHeaders({});
    }).not.toThrow();

    expect(() => {
      validateInjectHeaders({
        request: ["traceparent"],
      });
    }).not.toThrow();

    expect(() => {
      validateInjectHeaders({
        response: ["traceparent"],
      });
    }).not.toThrow();
  });

  test("validates all headers in array", () => {
    expect(() => {
      validateInjectHeaders({
        request: ["traceparent", "authorization", "x-request-id"],
      });
    }).toThrow(TypeError);
  });
});

describe("validateCaptureAttributes()", () => {
  test("validates requestHeaders", () => {
    expect(() => {
      validateCaptureAttributes({
        requestHeaders: ["user-agent", "accept"],
      });
    }).not.toThrow();

    expect(() => {
      validateCaptureAttributes({
        requestHeaders: ["cookie"],
      });
    }).toThrow(TypeError);
  });

  test("validates responseHeaders", () => {
    expect(() => {
      validateCaptureAttributes({
        responseHeaders: ["content-type", "x-trace-id"],
      });
    }).not.toThrow();

    expect(() => {
      validateCaptureAttributes({
        responseHeaders: ["set-cookie"],
      });
    }).toThrow(TypeError);
  });

  test("validates both requestHeaders and responseHeaders", () => {
    expect(() => {
      validateCaptureAttributes({
        requestHeaders: ["user-agent"],
        responseHeaders: ["content-type"],
      });
    }).not.toThrow();

    expect(() => {
      validateCaptureAttributes({
        requestHeaders: ["authorization"],
        responseHeaders: ["content-type"],
      });
    }).toThrow(TypeError);

    expect(() => {
      validateCaptureAttributes({
        requestHeaders: ["user-agent"],
        responseHeaders: ["set-cookie"],
      });
    }).toThrow(TypeError);
  });

  test("handles empty arrays", () => {
    expect(() => {
      validateCaptureAttributes({
        requestHeaders: [],
        responseHeaders: [],
      });
    }).not.toThrow();
  });

  test("handles undefined properties", () => {
    expect(() => {
      validateCaptureAttributes({});
    }).not.toThrow();

    expect(() => {
      validateCaptureAttributes({
        requestHeaders: ["user-agent"],
      });
    }).not.toThrow();

    expect(() => {
      validateCaptureAttributes({
        responseHeaders: ["content-type"],
      });
    }).not.toThrow();
  });

  test("validates all headers in array", () => {
    expect(() => {
      validateCaptureAttributes({
        requestHeaders: ["user-agent", "cookie", "accept"],
      });
    }).toThrow(TypeError);
  });
});

describe("error messages", () => {
  test("provides helpful error for blocked headers", () => {
    try {
      validateHeaderName("authorization");
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TypeError);
      expect((err as Error).message).toContain("authorization");
      expect((err as Error).message).toContain("sensitive credentials");
      expect((err as Error).message).toContain("https://docs.bun.sh/api/telemetry#security");
    }
  });

  test("provides helpful error for pattern matches", () => {
    try {
      validateHeaderName("x-secret-key");
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TypeError);
      expect((err as Error).message).toContain("x-secret-key");
      expect((err as Error).message).toContain("blocked pattern");
      expect((err as Error).message).toContain("sensitive information");
    }
  });

  test("preserves original header name in error message", () => {
    try {
      validateHeaderName("Authorization");
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect((err as Error).message).toContain("Authorization");
    }

    try {
      validateHeaderName("  cookie  ");
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect((err as Error).message).toContain("cookie");
    }
  });
});
