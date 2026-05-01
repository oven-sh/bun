// Benchmark fetch() decoding gzip Content-Encoding — the path PR #16100
// found regressed (Next.js standalone server). Server gzips responses,
// client inflates them via the streaming inflate path.
import { bench, group, run } from "../runner.mjs";
import zlib from "node:zlib";

const html = Buffer.from("<div>Hello World</div>".repeat(500));
const htmlGz = zlib.gzipSync(html, { level: 6 });

using server = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/gz") {
      return new Response(htmlGz, {
        headers: { "Content-Encoding": "gzip", "Content-Type": "text/html" },
      });
    }
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  },
});

const base = `http://localhost:${server.port}`;

group("fetch + gzip decode", () => {
  bench("11KB gzipped → text()", async () => {
    const res = await fetch(`${base}/gz`);
    await res.text();
  });
  bench("11KB plain → text()", async () => {
    const res = await fetch(`${base}/plain`);
    await res.text();
  });
});

await run();
