/**
 * bun-otel - OpenTelemetry SDK for Bun runtime
 *
 * This package provides a drop-in replacement for @opentelemetry/sdk-node
 * with Bun-native instrumentations for zero-overhead observability.
 *
 * @example
 * ```typescript
 * import { BunSDK } from 'bun-otel';
 *
 * const sdk = new BunSDK();
 * sdk.start();
 *
 * // Now all Bun.serve() and fetch() calls are automatically traced
 * ```
 *
 * @module bun-otel
 */

// Re-export BunSDK (main entry point)
export { BunSDK } from "./src/BunSDK";
export type { BunSDK2Config as BunSDKConfig } from "./src/BunSDK";
