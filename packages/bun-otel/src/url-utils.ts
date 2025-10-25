/**
 * Parse URL path and host information for OpenTelemetry semantic conventions.
 *
 * @param url - The URL path (e.g., "/api/users?id=123")
 * @param host - The host header value (e.g., "localhost:3000", "[::1]:3000", "example.com")
 * @returns Object with url.path, server.address, and optionally url.query and server.port
 */
export function parseUrlAndHost(
  url: string,
  host: string,
): {
  "url.path": string;
  "server.address": string;
  "url.query"?: string;
  "server.port"?: number;
} {
  const raw = url || "/";
  const qIndex = raw.indexOf("?");
  const path = qIndex === -1 ? raw : raw.slice(0, qIndex);
  const query = qIndex === -1 ? "" : raw.slice(qIndex + 1);

  // Parse host:port including IPv6 [::1]:3000
  let hostname = host;
  let port: number | undefined;

  if (host.startsWith("[")) {
    // IPv6 address with optional port: [::1]:3000 or [::1]
    const end = host.indexOf("]");
    if (end !== -1) {
      hostname = host.slice(0, end + 1);
      if (host[end + 1] === ":") {
        port = parseInt(host.slice(end + 2), 10);
      }
    }
  } else {
    // Regular hostname:port or just hostname
    const parts = host.split(":");
    if (parts.length > 1) {
      hostname = parts[0];
      port = parseInt(parts[1], 10);
    }
  }

  const attrs: Record<string, any> = {
    "url.path": path,
    "server.address": hostname,
  };

  if (query) attrs["url.query"] = query;
  if (Number.isFinite(port)) attrs["server.port"] = port!;

  return attrs as any;
}
