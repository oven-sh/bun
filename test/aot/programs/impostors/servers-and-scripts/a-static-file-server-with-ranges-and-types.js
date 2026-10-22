import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, normalize, sep } from "node:path";

const root = mkdtempSync(join(tmpdir(), "static-"));
mkdirSync(join(root, "css"));
writeFileSync(join(root, "index.html"), "<h1>home</h1>");
writeFileSync(join(root, "css", "site.css"), "body { margin: 0 }");
writeFileSync(join(root, "data.bin"), Buffer.from(Array.from({ length: 100 }, (_, i) => i)));
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css" };

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    let pathname = decodeURIComponent(new URL(request.url).pathname);
    if (pathname.endsWith("/")) pathname += "index.html";
    const full = normalize(join(root, pathname));
    if (!full.startsWith(root + sep)) return new Response("forbidden", { status: 403 });
    const file = Bun.file(full);
    if (!(await file.exists())) return new Response("not found", { status: 404 });
    const headers = { "content-type": types[extname(full)] ?? "application/octet-stream", "accept-ranges": "bytes" };
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get("range") ?? "");
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Math.min(Number(range[2]), file.size - 1) : file.size - 1;
      if (start > end) return new Response(null, { status: 416, headers: { "content-range": "bytes */" + file.size } });
      return new Response(file.slice(start, end + 1), { status: 206, headers: { ...headers, "content-range": `bytes ${start}-${end}/${file.size}` } });
    }
    return new Response(request.method === "HEAD" ? null : file, { headers: { ...headers, "content-length": String(file.size) } });
  },
});

async function show(path, init) {
  const answer = await fetch(server.url.origin + path, init);
  const body = new Uint8Array(await answer.arrayBuffer());
  console.log(path, answer.status, answer.headers.get("content-type"), answer.headers.get("content-length"), answer.headers.get("content-range"), body.length, body.length < 20 ? new TextDecoder("latin1").decode(body).replace(/[^ -~]/g, ".") : "");
}
await show("/");
await show("/css/site.css");
await show("/css/missing.css");
await show("/data.bin");
await show("/data.bin", { headers: { range: "bytes=10-19" } });
await show("/data.bin", { headers: { range: "bytes=95-" } });
await show("/data.bin", { headers: { range: "bytes=200-300" } });
await show("/index.html", { method: "HEAD" });
await show("/%2e%2e/%2e%2e/etc/hostname");
server.stop(true);
rmSync(root, { recursive: true });
