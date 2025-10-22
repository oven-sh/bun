/**
 * OpenTelemetry instrumentations for Bun native runtime.
 *
 * This module exports Bun-specific instrumentations that use native telemetry hooks
 * instead of monkey-patching for zero-overhead observability.
 *
 * @module bun-otel/instruments
 */

export { BunFetchInstrumentation } from "./BunFetchInstrumentation";
export type { BunFetchInstrumentationConfig } from "./BunFetchInstrumentation";

export { BunHttpInstrumentation } from "./BunHttpInstrumentation";
export type { BunHttpInstrumentationConfig } from "./BunHttpInstrumentation";
