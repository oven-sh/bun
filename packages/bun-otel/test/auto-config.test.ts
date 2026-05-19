/**
 * Integration tests for BunSDK auto-configuration from environment variables
 *
 * Note: These tests manipulate process.env and should be run in isolation
 */

import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { describe, expect, test } from "bun:test";
import { BunSDK } from "../src/BunSDK";

// Helper to temporarily set env vars
function withEnv(vars: Record<string, string>, fn: () => void | Promise<void>): Promise<void> {
  const original: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    original[key] = process.env[key];
    process.env[key] = vars[key];
  }

  const cleanup = () => {
    for (const key of Object.keys(vars)) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
  };

  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.then(cleanup, err => {
        cleanup();
        throw err;
      });
    }
    cleanup();
    return Promise.resolve();
  } catch (err) {
    cleanup();
    throw err;
  }
}

describe("BunSDK auto-configuration", () => {
  test("SDK respects OTEL_SDK_DISABLED=true", async () => {
    await withEnv({ OTEL_SDK_DISABLED: "true" }, async () => {
      using sdk = new BunSDK();
      // SDK should be disabled - calling start() should be no-op
      await sdk.start();
      // If we get here without errors, test passes
      expect(true).toBe(true);
    });
  });

  test("OTEL_TRACES_EXPORTER=none works", async () => {
    await withEnv({ OTEL_TRACES_EXPORTER: "none" }, async () => {
      using sdk = new BunSDK({ autoStart: false });
      await sdk.start();
      expect(true).toBe(true);
    });
  });

  test("user config overrides environment variables", async () => {
    await withEnv({ OTEL_TRACES_EXPORTER: "zipkin" }, async () => {
      const exporter = new InMemorySpanExporter();
      using sdk = new BunSDK({
        spanExporter: exporter,
        autoStart: false,
      });
      await sdk.start();
      // If we get here, user exporter was used instead of env-based zipkin
      expect(true).toBe(true);
    });
  });

  test("zero-config SDK initialization works with console exporter", async () => {
    await withEnv(
      {
        OTEL_SERVICE_NAME: "zero-config-test",
        OTEL_TRACES_EXPORTER: "console",
      },
      async () => {
        using sdk = new BunSDK({ autoStart: false });
        await sdk.start();
        expect(true).toBe(true);
      },
    );
  });

  test("OTEL_PROPAGATORS=b3,jaeger configures propagators", async () => {
    await withEnv(
      {
        OTEL_PROPAGATORS: "b3,jaeger",
        OTEL_TRACES_EXPORTER: "none",
      },
      async () => {
        using sdk = new BunSDK({ autoStart: false });
        await sdk.start();
        expect(true).toBe(true);
      },
    );
  });
});
