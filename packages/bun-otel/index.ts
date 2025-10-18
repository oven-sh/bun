// Barrel export for bun-otel package

// Core functionality - no dependency on @opentelemetry/sdk-node
export { installBunNativeTracing } from "./otel-core";
export type { InstallBunNativeTracingOptions } from "./otel-core";

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
