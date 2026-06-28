// Minimal local npm registry that serves packuments from a disk cache.
// First run with `--prime` to download everything via the real registry;
// subsequent runs serve from disk so wall-clock excludes network entirely.

import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CACHE = process.env.PACKUMENT_CACHE ?? "/tmp/bun-packument-cache";
mkdirSync(CACHE, { recursive: true });

const upstream = "https://registry.npmjs.org";

function cachePath(name: string) {
  return join(CACHE, encodeURIComponent(name) + ".json");
}

// Preload everything into memory so the server adds zero disk I/O variance.
const mem = new Map<string, Uint8Array>();
for (const f of readdirSync(CACHE)) {
  mem.set(decodeURIComponent(f.replace(/\.json$/, "")), new Uint8Array(readFileSync(join(CACHE, f))));
}

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    let name = decodeURIComponent(url.pathname.slice(1));
    if (!name) return new Response("ok");
    const cached = mem.get(name);
    if (cached) {
      return new Response(cached, { headers: { "content-type": "application/json" } });
    }
    // Miss → fetch upstream, cache, serve.
    const r = await fetch(`${upstream}/${encodeURIComponent(name)}`, {
      headers: { accept: "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8" },
    });
    const body = new Uint8Array(await r.arrayBuffer());
    writeFileSync(cachePath(name), body);
    mem.set(name, body);
    return new Response(body, {
      status: r.status,
      headers: { "content-type": "application/json" },
    });
  },
});

console.log(`http://localhost:${server.port}/`);
console.error(
  `[local-registry] cache=${CACHE} (${readdirSync(CACHE).length} cached) port=${server.port}`,
);
