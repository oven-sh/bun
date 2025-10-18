import type { TextMapGetter } from "@opentelemetry/api";
import type { IncomingHttpHeaders, IncomingMessage, OutgoingHttpHeaders } from "http";

/**
 * Request-like type for different server implementations
 * Supports both Bun's native Request and Node.js IncomingMessage
 */
export type RequestLike = Request | IncomingMessage;

/**
 * Headers-like interface matching Bun.telemetry.HeadersLike
 * Minimal interface that can be implemented by both native objects and Headers
 */
type BunHeadersLike = {
  get(name: string): string | null;
  keys(): string[];
};
type NodeHeadersLike = IncomingHttpHeaders | OutgoingHttpHeaders;

export type HeadersLike = BunHeadersLike | NodeHeadersLike;

/**
 * URL information extracted from a request
 */
export interface UrlInfo {
  fullUrl: string;
  pathname: string;
  host: string;
  scheme: string;
  userAgent: string | undefined;
  contentLength: number | undefined;
}

/**
 * Type guard for fetch API Request
 */
export function isFetchRequest(req: RequestLike): req is Request {
  return req instanceof Request;
}

export function isBunHeadersLike(headers: HeadersLike): headers is BunHeadersLike {
  return (
    typeof headers === "object" &&
    headers !== null &&
    typeof (headers as BunHeadersLike).get === "function" &&
    typeof (headers as BunHeadersLike).keys === "function"
  );
}

/**
 * Extract URL information from either Request or IncomingMessage
 */
export function getUrlInfo(req: RequestLike): UrlInfo {
  if (isFetchRequest(req)) {
    const url = new URL(req.url);
    const contentLengthHeader = req.headers.get("content-length");
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : undefined;

    return {
      fullUrl: req.url,
      pathname: url.pathname,
      host: url.host,
      scheme: url.protocol.replace(":", ""),
      userAgent: req.headers.get("user-agent") || undefined,
      contentLength: Number.isFinite(contentLength) ? contentLength : undefined,
    };
  }

  // IncomingMessage (Node.js http.createServer)
  const host = (Array.isArray(req.headers.host) ? req.headers.host[0] : req.headers.host) || "localhost";
  const protocol = (req.socket as any)?.encrypted ? "https" : "http";
  const pathname = req.url || "/";
  const fullUrl = `${protocol}://${host}${pathname}`;

  const userAgent = req.headers["user-agent"];
  const contentLengthHeader = req.headers["content-length"];
  const contentLengthStr = Array.isArray(contentLengthHeader) ? contentLengthHeader[0] : contentLengthHeader;
  const contentLength = contentLengthStr ? Number(contentLengthStr) : undefined;

  return {
    fullUrl,
    pathname,
    host,
    scheme: protocol,
    userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent,
    contentLength: Number.isFinite(contentLength) ? contentLength : undefined,
  };
}

/**
 * Header getter for null/undefined carriers
 */
const nilHeaderGetter: TextMapGetter<unknown> = {
  keys: (_carrier: unknown): string[] => [],
  get: (_carrier: unknown, _key: string): string | undefined => undefined,
};

/**
 * Header getter for fetch API Request
 */
const bunHeadersGetter: TextMapGetter<BunHeadersLike> = {
  keys: (carrier: BunHeadersLike): string[] => Array.from(carrier.keys()),
  get: (carrier: BunHeadersLike, key: string): string | undefined => carrier.get(key) || undefined,
};
const fetchRequestHeaderGetter: TextMapGetter<Request> = {
  keys: (carrier: Request): string[] => Array.from(carrier.headers.keys()),
  get: (carrier: Request, key: string): string | undefined => carrier.headers.get(key) || undefined,
};

/**
 * Header getter for Node.js IncomingMessage
 */
export const nodeHeaderGetter: TextMapGetter<NodeHeadersLike> = {
  keys: (carrier: NodeHeadersLike): string[] => Object.keys(carrier),
  get: (carrier: NodeHeadersLike, key: string): string | undefined => {
    const value = (carrier as any)[key.toLowerCase()];
    if (value == null) return undefined;
    if (Array.isArray(value)) return value.length > 0 ? value[0] : undefined;
    return String(value);
  },
};
const nodeRequestHeaderGetter: TextMapGetter<IncomingMessage> = {
  keys: (carrier: IncomingMessage): string[] => nodeHeaderGetter.keys(carrier.headers),
  get: (carrier: IncomingMessage, key: string): string | undefined => {
    const value = carrier.headers[key.toLowerCase()];
    if (value == null) return undefined;
    if (Array.isArray(value)) return value.length > 0 ? value[0] : undefined;
    return String(value);
  },
};

export function headerLikeHeaderGetter(headers: HeadersLike): TextMapGetter<HeadersLike> {
  return headers ? (isBunHeadersLike(headers) ? bunHeadersGetter : nodeHeaderGetter) : nilHeaderGetter;
}

/**
 * Get appropriate header getter for the request type
 */
export function requestLikeHeaderGetter(req: RequestLike): TextMapGetter<RequestLike> {
  return req && req.headers
    ? isFetchRequest(req)
      ? fetchRequestHeaderGetter
      : nodeRequestHeaderGetter
    : nilHeaderGetter;
}
