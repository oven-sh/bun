// Probe for step-3 bullet 3: does a warm h1 keepalive socket satisfy an
// H1OrH2 request, keeping the pool on h1 forever?
//
// Sequence (all with h2 flag ON, sequential not concurrent):
//   1. fetch with {protocol:"http1"} to force an h1 socket into the pool
//   2. fetch with default (H1OrH2) — expect it to reuse the h1 pooled socket
//   3. read server stats: if tcpConnections stays 1 and alpn=http/1.1, confirmed.
//
// Usage: BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT=1 bun warm-pool.ts <url>

import { tls } from "./tls.ts";

const url = process.argv[2];
const ca = tls.cert;

// Hit /stats (reports the alpn of the socket serving THIS request) with a
// forced protocol first, then default, to see which socket the default reuses.
// Use only the /stats endpoint so every fetch is comparable.

const get = (proto?: string) =>
  fetch(`${url}/stats`, { tls: { ca }, ...(proto ? { protocol: proto } : {}) } as any).then(r => r.json());

// 1) Force h1: creates an h1 pooled socket.
const a = await get("http1.1");
// 2) Default (H1OrH2): active_h2_sessions is empty, pending empty, h1 pool has
//    one socket → per existing_socket() this should reuse the h1 socket.
const b = await get();
// 3) Default again.
const c = await get();

console.log(
  JSON.stringify({
    forceH1: { alpn: a.alpn, sockets: a.tcpConnections },
    default1: { alpn: b.alpn, sockets: b.tcpConnections },
    default2: { alpn: c.alpn, sockets: c.tcpConnections },
    // If default requests ride the h1 pooled socket, alpn stays http/1.1 and
    // socket count stays 1.
    poolPinnedToH1: b.alpn === "http/1.1" && b.tcpConnections === a.tcpConnections,
  }),
);
