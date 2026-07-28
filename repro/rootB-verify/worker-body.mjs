// One worker instance: arm one in-flight op of every cross-thread completion
// source, then sit. Parent terminates us mid-flight. Every op is self-contained
// and loopback-only (no public internet). Catch-and-ignore everywhere: the
// point is to have work airborne on a process-global thread when the VM dies,
// not to observe the result.

import { parentPort, threadId } from "node:worker_threads";
import fs from "node:fs";
import fsp from "node:fs/promises";
import zlib from "node:zlib";
import crypto from "node:crypto";
import dns from "node:dns/promises";
import os from "node:os";
import path from "node:path";

const sink = () => {};
const swallow = (p) => Promise.resolve(p).then(sink, sink);

// One scratch root for all iterations (verify.mjs removes it on exit).
const root = process.env.ROOTB_SCRATCH ?? path.join(os.tmpdir(), "rootB-verify");
const tmp = path.join(root, String(threadId));
fs.mkdirSync(tmp, { recursive: true });
const tmpFile = path.join(tmp, "a.txt");
fs.writeFileSync(tmpFile, Buffer.alloc(1 << 16, "x").toString());

// fetch / HTMLRewriter / TLS (HTTP thread -> FetchTasklet)
{
  const srv = Bun.serve({
    port: 0,
    fetch: () => new Response("x".repeat(1 << 14)),
  });
  swallow(fetch(`http://127.0.0.1:${srv.port}/`).then((r) => r.text()));
  swallow(
    fetch(`http://127.0.0.1:${srv.port}/`).then((r) =>
      new HTMLRewriter().on("*", { text() {} }).transform(r).text(),
    ),
  );
}

// Bun.file / Bun.write (WorkPool -> WorkTask<WriteFile>/<ReadFile>)
swallow(Bun.write(path.join(tmp, "b.txt"), "y".repeat(1 << 16)));
swallow(Bun.file(tmpFile).text());

// node:fs promises (WorkPool -> AsyncFSTask)
swallow(fsp.readFile(tmpFile));
swallow(fsp.stat(tmpFile));
swallow(fsp.readdir(tmp, { recursive: true }));

// pbkdf2 / scrypt / generateKeyPair (WorkPool -> AnyTaskJob)
crypto.pbkdf2("p", "s", 100000, 64, "sha512", sink);
crypto.scrypt("p", "saltsalt", 64, sink);
crypto.generateKeyPair("rsa", { modulusLength: 2048 }, sink);

// Bun.password (WorkPool -> PasswordJob)
swallow(Bun.password.hash("hunter2", { algorithm: "bcrypt", cost: 8 }));

// zlib (WorkPool -> CompressionStream async_job_run)
zlib.deflate(Buffer.alloc(1 << 18), sink);
zlib.gzip(Buffer.alloc(1 << 18), sink);

// S3 (HTTP thread -> S3HttpSimpleTask); loopback endpoint that never answers.
{
  const srv = Bun.serve({ port: 0, fetch: () => new Promise(sink) });
  const s3 = new Bun.S3Client({
    accessKeyId: "x",
    secretAccessKey: "y",
    endpoint: `http://127.0.0.1:${srv.port}`,
    bucket: "b",
  });
  swallow(s3.file("k").text());
}

// Bun.build (BundleThread -> JSBundleCompletionTask)
{
  const entry = path.join(tmp, "entry.ts");
  fs.writeFileSync(entry, `export const x: number = 1;\n`);
  swallow(Bun.build({ entrypoints: [entry], target: "bun" }));
}

// Transpiler.transform (WorkPool -> ConcurrentPromiseTask<TransformTask>)
swallow(new Bun.Transpiler({ loader: "tsx" }).transform("const x: number = 1;"));

// dns.lookup (c-ares; clean-by-construction via close_dns_for_terminate)
swallow(dns.lookup("localhost"));

// WebCrypto (WorkPool -> ConcurrentCppTask)
swallow(
  crypto.subtle.digest("SHA-256", new Uint8Array(1 << 16)),
);
swallow(
  crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]),
);

// Glob (WorkPool -> ConcurrentPromiseTask<WalkTask>)
swallow(Array.fromAsync(new Bun.Glob("**/*").scan(tmp)));

// zstd (WorkPool -> AnyTaskJob<ZstdCtx>)
swallow(Bun.zstdCompress(Buffer.alloc(1 << 16)));

// Signal parent that everything is airborne.
parentPort.postMessage("armed");

// Keep the loop alive so terminate() lands mid-flight.
setInterval(sink, 1 << 30);
