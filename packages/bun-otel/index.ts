// Barrel export for bun-otel package

// raw telemetry core (internal use)
export { installBunNativeTracing, type InstallBunNativeTracingOptions } from "./otel-core";

// Shared types and utilities
export {
  getUrlInfo,
  headerLikeHeaderGetter,
  isBunHeadersLike,
  isFetchRequest,
  nodeHeaderGetter,
  requestLikeHeaderGetter,
} from "./otel-types";
export type { HeadersLike, RequestLike, UrlInfo } from "./otel-types";

// BunSDK - built on stable @opentelemetry packages (1.x)
export { BunSDK } from "./bun-sdk";
export type { BunSDKConfiguration } from "./bun-sdk";

// BunFetchInstrumentation - instruments global.fetch for distributed tracing
export { BunFetchInstrumentation } from "./BunFetchInstrumentation";
