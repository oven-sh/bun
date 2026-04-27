import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "h3b-"));
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
  port: 0,
  h3: true,
  h1: false,
  tls: { cert: readFileSync(certPath, "utf8"), key: readFileSync(keyPath, "utf8") },
  fetch(req) {
    return new Response("Hello, World!");
  },
});
console.log(server.port);
setTimeout(() => {}, 1e9);
