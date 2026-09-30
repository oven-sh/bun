// Scratch probe, outside the repo: locked-fork flow on npm and on the three bun binaries.
// root -> parent@1.0.0 -> kept@^1.0.0, overrides { kept: "npm:short@1.0.0" }; install; delete the override; install.
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

type Pkg = { name: string; version: string; dependencies?: Record<string, string> };
async function registry(packages: Pkg[]) {
  const served = new Map<string, { manifest: Pkg; tarball: Uint8Array; tarballPath: string; integrity: string }>();
  for (const manifest of packages) {
    const { name, version } = manifest;
    const tarball = await new Bun.Archive(
      { "package/package.json": JSON.stringify(manifest), "package/index.js": `module.exports = ${JSON.stringify(name)};` },
      { compress: "gzip" },
    ).bytes();
    served.set(name, { manifest, tarball, tarballPath: `/${name}/-/${name}-${version}.tgz`, integrity: "sha512-" + new Bun.CryptoHasher("sha512").update(tarball).digest("base64") });
  }
  const requests: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const { origin, pathname } = new URL(request.url);
      requests.push(pathname);
      for (const { manifest, tarball, tarballPath, integrity } of served.values()) {
        if (pathname === tarballPath) return new Response(tarball);
        if (pathname !== `/${manifest.name}`) continue;
        return Response.json({ name: manifest.name, "dist-tags": { latest: manifest.version }, versions: { [manifest.version]: { ...manifest, dist: { tarball: origin + tarballPath, integrity } } } });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return { url: server.url.href, requests, stop: () => server.stop(true) };
}
const env: Record<string, string> = { ...(process.env as Record<string, string>), NO_COLOR: "1", BUN_DEBUG_QUIET_LOGS: "1" };
delete env.FORCE_COLOR;
const installedName = (cwd: string, name: string) => {
  const p = join(cwd, "node_modules", name, "package.json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")).name : null;
};
const tools: Record<string, (url: string, cwd: string) => string[]> = {
  "npm 11.16.0": (url, cwd) => ["npm", "install", "--registry", url, "--cache", join(cwd, ".npm-cache"), "--no-audit", "--no-fund", "--loglevel", "error"],
  "bun canary": () => ["/workspace/bun/build/release/bun", "install"],
  "bun base": () => ["/workspace/bun/build/release-base/bun", "install"],
  "bun pr": () => ["/workspace/bun/build/release-pr/bun", "install"],
};
for (const [label, cmd] of Object.entries(tools)) {
  const reg = await registry([
    { name: "short", version: "1.0.0" }, { name: "kept", version: "1.0.0" },
    { name: "parent", version: "1.0.0", dependencies: { kept: "^1.0.0" } },
  ]);
  const cwd = mkdtempSync(join(tmpdir(), "disp-fork-"));
  writeFileSync(join(cwd, "bunfig.toml"), `[install]\nregistry = "${reg.url}"\n`);
  const run = async () => {
    const proc = Bun.spawn({ cmd: cmd(reg.url, cwd), cwd, env: { ...env, BUN_INSTALL_CACHE_DIR: join(cwd, ".cache") }, stdout: "pipe", stderr: "pipe" });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { exitCode, out: out.trim().split("\n").map(l => l.trim()).filter(Boolean).slice(-3), err: err.trim().split("\n").filter(l => /error|warn|ERR/i.test(l)).slice(0, 4) };
  };
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "app", version: "1.0.0", dependencies: { parent: "1.0.0" }, overrides: { kept: "npm:short@1.0.0" } }));
  const first = await run();
  const before = installedName(cwd, "kept");
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "app", version: "1.0.0", dependencies: { parent: "1.0.0" } }));
  reg.requests.length = 0;
  const second = await run();
  console.log(JSON.stringify({ tool: label, first: { exit: first.exitCode, keptIs: before, err: first.err }, afterDeletingOverride: { exit: second.exitCode, keptIs: installedName(cwd, "kept"), out: second.out, err: second.err, requests: reg.requests.toSorted() } }));
  reg.stop();
  rmSync(cwd, { recursive: true, force: true });
}
