import { mkdtempSync, mkdirSync, chmodSync, symlinkSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
const base = mkdtempSync(tmpdir() + "/s-");
const ls = d => readdirSync(d, { recursive: true }).sort().join(" ") || "(nothing)";
const run = async (name, files, dest) =>
  console.log(name, await new Bun.Archive(files).extract(dest).then(n => "resolved " + n, e => "REJECTED " + e.message), "| members", Object.keys(files).length, "| on disk:", ls(dest));
mkdirSync(base + "/ro"); chmodSync(base + "/ro", 0o555);
await run("1 read-only destination:", { "pkg/index.js": "x", "pkg/lib/a.js": "y" }, base + "/ro");
await run("2 `a`, then `a/b`:", { "a": "file", "a/b": "lost", "c": "c" }, base + "/two");
mkdirSync(base + "/root/usr/bin", { recursive: true }); symlinkSync("usr/bin", base + "/root/bin");
await run("3 layer 2 over bin -> usr/bin:", { "bin/tool": "#!/bin/sh\n", "etc/conf": "k=v" }, base + "/root");
