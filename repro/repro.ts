// Usage: bun /tmp/notes/repro/repro.ts <bun-exe-under-test> [label-filter-regex]
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tls } from "/workspace/bun/test/harness.ts";

const exe = process.argv[2] ?? process.execPath;
const only = new RegExp(process.argv[3] ?? ".");
const tgz = await new Bun.Archive({
  "package/package.json": JSON.stringify({ name: "@corp/thing", version: "1.0.0", main: "index.js" }),
  "package/index.js": `module.exports = "hello from @corp/thing";\n`,
}).bytes("gzip");
const integrity = "sha512-" + new Bun.CryptoHasher("sha512").update(tgz).digest("base64");
const requests: string[] = [];
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  tls,
  fetch(req) {
    const url = new URL(req.url);
    requests.push(req.method + " " + url.pathname);
    if (url.pathname.toLowerCase() === "/@corp%2fthing")
      return Response.json({
        name: "@corp/thing",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { name: "@corp/thing", version: "1.0.0", main: "index.js", dist: { tarball: `https://127.0.0.1:${server.port}/@corp/thing/-/thing-1.0.0.tgz`, integrity } } },
      });
    if (url.pathname === "/@corp/thing/-/thing-1.0.0.tgz") return new Response(tgz);
    return new Response("not found", { status: 404 });
  },
});
const R = `https://127.0.0.1:${server.port}/`;
type Opts = { bunfig?: (root: string) => string; npmrc?: (root: string) => string; install?: boolean; env?: (root: string) => Record<string, string>; script?: string; args?: string[] };
async function run(label: string, o: Opts) {
  if (!only.test(label)) return;
  const root = mkdtempSync(join(tmpdir(), "repro-ca-"));
  const home = join(root, "home"), proj = join(root, "proj");
  mkdirSync(home);
  mkdirSync(proj);
  writeFileSync(join(root, "ca.pem"), tls.cert);
  writeFileSync(join(proj, "ca.pem"), tls.cert);
  if (o.bunfig) writeFileSync(join(proj, "bunfig.toml"), o.bunfig(root));
  if (o.npmrc) writeFileSync(join(proj, ".npmrc"), o.npmrc(root));
  if (o.install) writeFileSync(join(proj, "package.json"), JSON.stringify({ name: "proj", dependencies: { "@corp/thing": "1.0.0" } }));
  else writeFileSync(join(proj, "x.mjs"), o.script ?? `import v from "@corp/thing"; console.log(v);\n`);
  requests.length = 0;
  const t0 = performance.now();
  const proc = Bun.spawn({
    cmd: o.install ? [exe, "install"] : [exe, ...(o.args ?? []), "x.mjs"],
    cwd: proj,
    env: { PATH: process.env.PATH!, HOME: home, BUN_INSTALL_CACHE_DIR: join(root, "cache"), NO_COLOR: "1", BUN_DEBUG_QUIET_LOGS: "1", ...(o.env?.(root) ?? {}) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  console.log(`--- ${label}  (${Math.round(performance.now() - t0)} ms)`);
  console.log(`  requests: ${JSON.stringify(requests)}  exit: ${exitCode}`);
  console.log(`  stdout: ${JSON.stringify(stdout.replaceAll(root, "<root>"))}`);
  console.log(`  stderr: ${JSON.stringify(stderr.replaceAll(root, "<root>").split("\n").filter(Boolean).join("\n"))}`);
  rmSync(root, { recursive: true, force: true });
}
const reg = `[install]\nregistry = "${R}"\n`;
await run("install, no ca (control: TLS error)", { install: true, bunfig: () => reg });
await run("install, bunfig cafile (control: ok)", { install: true, bunfig: root => reg + `cafile = ${JSON.stringify(join(root, "ca.pem"))}\n` });
await run("runtime, no ca (expect failure)", { bunfig: () => reg });
await run("runtime, bunfig cafile abs", { bunfig: root => reg + `cafile = ${JSON.stringify(join(root, "ca.pem"))}\n` });
await run("runtime, bunfig cafile rel", { bunfig: () => reg + `cafile = "ca.pem"\n` });
await run("runtime, bunfig ca", { bunfig: () => reg + `ca = ${JSON.stringify(tls.cert)}\n` });
await run("runtime, NODE_EXTRA_CA_CERTS only", { bunfig: () => reg, env: root => ({ NODE_EXTRA_CA_CERTS: join(root, "ca.pem") }) });
await run("runtime, bunfig cafile, fetch then import", {
  bunfig: root => reg + `cafile = ${JSON.stringify(join(root, "ca.pem"))}\n`,
  script: `try { await fetch(${JSON.stringify(R)}); console.log("fetch ok?!"); } catch (e) { console.log("fetch failed:", e.code); }\nconst { default: v } = await import("@corp/thing"); console.log(v);\n`,
});
await run("runtime, bunfig cafile missing", { bunfig: root => reg + `cafile = ${JSON.stringify(join(root, "missing.pem"))}\n` });
await run("runtime, bunfig ca invalid", { bunfig: () => reg + `ca = "not a certificate"\n` });
await run("install, npmrc registry + cafile (control)", { install: true, npmrc: root => `registry=${R}\ncafile=${join(root, "ca.pem")}\n` });
await run("runtime, npmrc registry + cafile", { npmrc: root => `registry=${R}\ncafile=${join(root, "ca.pem")}\n` });
await run("runtime, npmrc registry + bunfig cafile", { npmrc: () => `registry=${R}\n`, bunfig: root => `[install]\ncafile = ${JSON.stringify(join(root, "ca.pem"))}\n` });
await run("runtime, npmrc registry + ca", { npmrc: () => `registry=${R}\nca=${JSON.stringify(tls.cert)}\n` });
await run("runtime, npmrc scope registry only, no ca (expect TLS failure)", { npmrc: () => `@corp:registry=${R}\n` });
server.stop(true);
