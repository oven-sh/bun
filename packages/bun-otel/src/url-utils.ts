/**
 * URL attributes returned by parseUrlAndHost
 */
export type UrlAttrs = {
  "url.path": string;
  "server.address": string;
  "url.query"?: string;
  "server.port"?: number;
};

/**
 * Parse URL path and host information for OpenTelemetry semantic conventions.
 *
 * Custom implementation instead of standard URL class because:
 * - URL class requires valid URLs and throws on edge cases (e.g., "localhost:abc")
 * - We need graceful handling of malformed inputs from HTTP headers
 * - Output format matches OTel semantic conventions (e.g., IPv6 keeps brackets, query without "?")
 *
 * @param url - The URL path (e.g., "/api/users?id=123")
 * @param host - The host header value (e.g., "localhost:3000", "[::1]:3000", "example.com")
 * @returns Object with url.path, server.address, and optionally url.query and server.port
 */
export function parseUrlAndHost(url: string, host: string): UrlAttrs {
  const raw = url || "/";
  const qIndex = raw.indexOf("?");
  const path = qIndex === -1 ? raw : raw.slice(0, qIndex);
  const query = qIndex === -1 ? "" : raw.slice(qIndex + 1);

  // Parse host:port including IPv6 [::1]:3000
  const trimmedHost = host.trim();
  let hostname = trimmedHost;
  let port: number | undefined;

  if (trimmedHost.startsWith("[")) {
    // IPv6 address with optional port: [::1]:3000 or [::1]
    const end = trimmedHost.indexOf("]");
    if (end !== -1) {
      hostname = trimmedHost.slice(0, end + 1);
      if (trimmedHost[end + 1] === ":") {
        const p = Number(trimmedHost.slice(end + 2));
        if (Number.isInteger(p) && p >= 0 && p <= 65535) port = p;
      }
    }
  } else {
    // Regular hostname:port or just hostname
    const last = trimmedHost.lastIndexOf(":");
    if (last > -1) {
      const maybe = trimmedHost.slice(last + 1);
      const p = Number(maybe);
      // Always strip the port part from hostname, but only include port field if valid
      hostname = trimmedHost.slice(0, last);
      if (Number.isInteger(p) && p >= 0 && p <= 65535) {
        port = p;
      }
    }
  }

  const attrs: UrlAttrs = {
    "url.path": path,
    "server.address": hostname,
  };

  if (query) attrs["url.query"] = query;
  if (typeof port === "number" && Number.isFinite(port)) attrs["server.port"] = port;

  return attrs;
}
