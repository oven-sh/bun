// Scratch probe, outside the repo. In-process registry, no public network.
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
    served.set(name, {
      manifest,
      tarball,
      tarballPath: `/${name}/-/${name}-${version}.tgz`,
      integrity: "sha512-" + new Bun.CryptoHasher("sha512").update(tarball).digest("base64"),
    });
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
        return Response.json({
          name: manifest.name,
          "dist-tags": { latest: manifest.version },
          versions: { [manifest.version]: { ...manifest, dist: { tarball: origin + tarballPath, integrity } } },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return { url: server.url.href, requests, integrity: (n: string) => served.get(n)!.integrity, stop: () => server.stop(true) };
}

const env: Record<string, string> = { ...(process.env as Record<string, string>), NO_COLOR: "1", BUN_DEBUG_QUIET_LOGS: "1" };
delete env.FORCE_COLOR;

async function run(bin: string, cwd: string, args: string[]) {
  const proc = Bun.spawn({ cmd: [bin, ...args], cwd, env: { ...env, BUN_INSTALL_CACHE_DIR: join(cwd, ".cache") }, stdout: "pipe", stderr: "pipe" });
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { out, err, exitCode };
}

function locked(cwd: string) {
  const p = join(cwd, "bun.lock");
  if (!existsSync(p)) return null;
  const { packages = {}, overrides } = Bun.JSONC.parse(readFileSync(p, "utf8")) as any;
  return { packages: Object.fromEntries(Object.entries(packages).map(([k, v]: any) => [k, v[0]])), overrides: overrides ?? null };
}
const installedName = (cwd: string, name: string) => {
  const p = join(cwd, "node_modules", name, "package.json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")).name : null;
};
const lines = (s: string, url: string) =>
  s.replaceAll(url, "<registry>/").replaceAll(url.replace(/\/$/, ""), "<registry>").split("\n").map(l => l.trim()).filter(Boolean);

const bins: Record<string, string> = {
  canary: "/workspace/bun/build/release/bun",
  base: "/workspace/bun/build/release-base/bun",
  pr: "/workspace/bun/build/release-pr/bun",
};

// Flow A: a real install with an npm: alias override; the user deletes the override; bun.lock stays.
async function flowA(label: string, bin: string, target: string) {
  const reg = await registry([{ name: target, version: "1.0.0" }, { name: "kept", version: "1.0.0" }]);
  const cwd = mkdtempSync(join(tmpdir(), "disp-a-"));
  writeFileSync(join(cwd, "bunfig.toml"), `[install]\nregistry = "${reg.url}"\n`);
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "app", dependencies: { kept: "^1.0.0" }, overrides: { kept: `npm:${target}@1.0.0` } }));
  const first = await run(bin, cwd, ["install"]);
  const before = { locked: locked(cwd), installed: installedName(cwd, "kept") };
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "app", dependencies: { kept: "^1.0.0" } }));
  reg.requests.length = 0;
  const second = await run(bin, cwd, ["install"]);
  const after = { locked: locked(cwd), installed: installedName(cwd, "kept") };
  const reqs2 = reg.requests.toSorted();
  reg.requests.length = 0;
  const third = await run(bin, cwd, ["install", "--frozen-lockfile"]);
  console.log(JSON.stringify({
    flow: "A delete npm: override, keep bun.lock", bin: label, target,
    first: { exit: first.exitCode, ...before },
    second: { exit: second.exitCode, stderr: lines(second.err, reg.url), stdout: lines(second.out, reg.url), ...after, requests: reqs2 },
    thirdFrozen: { exit: third.exitCode, installed: installedName(cwd, "kept"), stderr: lines(third.err, reg.url).filter(l => /error|warn/i.test(l)) },
  }, null, 1));
  reg.stop();
  rmSync(cwd, { recursive: true, force: true });
}

// Flow H: a bun.lock that fails to load after its overrides; package.json has the alias name as a plain dependency.
async function flowH(label: string, bin: string, target: string) {
  const reg = await registry([{ name: target, version: "1.0.0" }, { name: "kept", version: "1.0.0" }, { name: "broken", version: "1.0.0" }]);
  const cwd = mkdtempSync(join(tmpdir(), "disp-h-"));
  writeFileSync(join(cwd, "bunfig.toml"), `[install]\nregistry = "${reg.url}"\n`);
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "app", dependencies: { kept: "^1.0.0" } }));
  writeFileSync(join(cwd, "bun.lock"), JSON.stringify({
    lockfileVersion: 2, configVersion: 1,
    workspaces: { "": { name: "app", dependencies: { kept: "^1.0.0" } } },
    overrides: { kept: `npm:${target}@1.0.0` },
    packages: { broken: ["broken@1.0.0", "", {}] },
  }));
  const r = await run(bin, cwd, ["install"]);
  console.log(JSON.stringify({
    flow: "H bun.lock fails to load after overrides", bin: label, target,
    exit: r.exitCode, stderr: lines(r.err, reg.url).filter(l => /error|warn|fail|404/i.test(l)),
    locked: locked(cwd), installed: installedName(cwd, "kept"), requests: reg.requests.toSorted(),
  }, null, 1));
  reg.stop();
  rmSync(cwd, { recursive: true, force: true });
}

const which = process.argv[2] ?? "all";
for (const [label, bin] of Object.entries(bins)) {
  for (const target of ["short", "some-other-package"]) {
    if (which === "all" || which === "a") await flowA(label, bin, target);
    if (which === "all" || which === "h") await flowH(label, bin, target);
  }
}
