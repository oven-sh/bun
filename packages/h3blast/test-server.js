// Minimal Bun HTTP/3 hello-world target for h3blast.
// Usage: bun test-server.js [port]
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "h3blast-srv-"));
const certPath = join(dir, "cert.pem");
const keyPath = join(dir, "key.pem");
spawnSync(
  "openssl",
  [
    "req",
    "-x509",
    "-nodes",
    "-newkey",
    "rsa:2048",
    "-days",
    "365",
    "-subj",
    "/CN=localhost",
    "-keyout",
    keyPath,
    "-out",
    certPath,
  ],
  { stdio: "ignore" },
);

const server = Bun.serve({
  port: Number(process.argv[2] ?? process.env.PORT ?? 3443),
  h3: true,
  h1: false,
  tls: { cert: readFileSync(certPath, "utf8"), key: readFileSync(keyPath, "utf8") },
  fetch() {
    return new Response("Hello, World!");
  },
});

console.error("listening", String(server.url));
setInterval(() => {}, 1 << 30);
