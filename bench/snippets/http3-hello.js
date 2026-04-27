import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

let cert, key;
if (process.argv[2] && process.argv[3]) {
  cert = readFileSync(process.argv[2], "utf8");
  key = readFileSync(process.argv[3], "utf8");
} else {
  const dir = mkdtempSync(join(tmpdir(), "h3-hello-"));
  const certPath = join(dir, "cert.pem");
  const keyPath = join(dir, "key.pem");
  const { status, stderr } = spawnSync(
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
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  if (status !== 0) {
    throw new Error("openssl failed: " + stderr);
  }
  cert = readFileSync(certPath, "utf8");
  key = readFileSync(keyPath, "utf8");
}

const TOTAL = 10_000_000;
var i = 0;

const server = Bun.serve({
  port: 3001,
  h3: true,
  h1: false,
  tls: { cert, key, rejectUnauthorized: false },
  fetch(req) {
    if (i++ === TOTAL - 1) setTimeout(() => process.exit(0));
    return new Response("Hello, World!" + i);
  },
});
setTimeout(() => {}, 999999);

console.log(String(server.url));
