// bun repro.mjs [gnu|posix]        needs GNU tar
import { $ } from "bun";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

const format = process.argv[2] ?? "gnu";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sparse-repro-"));
for (const d of ["src/package", "tmp", "cache", "app"]) fs.mkdirSync(path.join(dir, d), { recursive: true });
fs.writeFileSync(path.join(dir, "src/package/package.json"), JSON.stringify({ name: "sparse-pkg", version: "1.0.0" }));
// A sparse file: seven 512-byte extents in 300000 bytes. tar only maps a file that has holes on disk.
const fd = fs.openSync(path.join(dir, "src/package/m.bin"), "w");
for (const at of [0, 8192, 16384, 24576, 32768, 40960]) fs.writeSync(fd, Buffer.alloc(512, "x"), 0, 512, at);
fs.ftruncateSync(fd, 300_000);
fs.closeSync(fd);
await $`tar --sparse --hole-detection=raw --format=${format} -cf ../pkg.tar package/package.json package/m.bin`.cwd(path.join(dir, "src"));

const tar = fs.readFileSync(path.join(dir, "pkg.tar"));
const tgz = gzipSync(tar, { level: 0 }); // stored: byte n of the tar is byte 15 + n of the .tgz
// gnu: the sparse extension block follows the 'S' header. posix: the sparse map starts the member data.
const member = format === "gnu" ? tar.indexOf("package/m.bin") : tar.indexOf("GNUSparseFile");
const cut = process.env.CUT_IN_MAP ? 15 + member + 512 + 3 : 15 + 512 + 5;
const integrity = "sha512-" + createHash("sha512").update(tgz).digest("base64");
const tmp = path.join(dir, "tmp");

let exited = false;
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    if (!req.url.endsWith(".tgz")) {
      const dist = { integrity, tarball: `${server.url}sparse-pkg/-/sparse-pkg-1.0.0.tgz` };
      return Response.json({ name: "sparse-pkg", "dist-tags": { latest: "1.0.0" }, versions: { "1.0.0": { name: "sparse-pkg", version: "1.0.0", dist } } });
    }
    return new Response(
      new ReadableStream({
        type: "direct",
        async pull(c) {
          c.write(tgz.subarray(0, cut));
          await c.flush();
          // Send the rest after the extractor has started on the first piece.
          while (!exited && !fs.readdirSync(tmp).some(n => n.endsWith(".sparse-pkg"))) await Bun.sleep(5);
          await Bun.sleep(100);
          c.write(tgz.subarray(cut));
          await c.flush();
          c.close();
        },
      }),
    );
  },
});
fs.writeFileSync(path.join(dir, "app/package.json"), JSON.stringify({ name: "app", dependencies: { "sparse-pkg": "1.0.0" } }));
fs.writeFileSync(path.join(dir, "app/bunfig.toml"), `[install]\nregistry = "${server.url}"\n`);
const proc = Bun.spawn({
  cmd: [process.execPath, "install", ...process.argv.slice(3)],
  cwd: path.join(dir, "app"),
  env: { ...process.env, BUN_TMPDIR: tmp, TMPDIR: tmp, BUN_INSTALL_CACHE_DIR: path.join(dir, "cache"), BUN_INSTALL_STREAMING_DRAIN_THRESHOLD: "1" },
  stdout: "inherit",
  stderr: "inherit",
});
proc.exited.then(() => (exited = true));
console.log("exit code:", await proc.exited);
try { console.log("m.bin size:", fs.statSync(path.join(dir, "app/node_modules/sparse-pkg/m.bin")).size); } catch (e) { console.log("m.bin missing"); }
server.stop(true);
fs.rmSync(dir, { recursive: true, force: true });
