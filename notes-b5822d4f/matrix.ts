// Behaviour matrix on a kept lockfile: base build vs PR build.
// Run: bun /tmp/meas/matrix.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";

const BINARIES: Record<string, string> = {
  base: "/workspace/bun/build/release-base/bun",
  pr: "/workspace/bun/build/release-pr/bun",
};

type Pkg = { name: string; version: string; dependencies?: Record<string, string> };

async function serve(packages: Pkg[]) {
  const served = new Map<string, { manifest: Pkg; tarball: Uint8Array; tarballPath: string; integrity: string }>();
  for (const manifest of packages) {
    const tarball = await new Bun.Archive(
      { "package/package.json": JSON.stringify(manifest), "package/index.js": `module.exports = ${JSON.stringify(manifest.name)};` },
      { compress: "gzip" },
    ).bytes();
    served.set(manifest.name, {
      manifest,
      tarball,
      tarballPath: `/${manifest.name}/-/${manifest.name}-${manifest.version}.tgz`,
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
          _id: manifest.name,
          name: manifest.name,
          "dist-tags": { latest: manifest.version },
          versions: {
            [manifest.version]: {
              ...manifest,
              _id: `${manifest.name}@${manifest.version}`,
              dist: { tarball: origin + tarballPath, integrity },
            },
          },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return {
    url: server.url.href,
    origin: server.url.origin,
    requests,
    integrity: (name: string) => served.get(name)!.integrity,
    tarballUrl: (name: string) => server.url.origin + served.get(name)!.tarballPath,
    stop: () => server.stop(true),
  };
}

const targets = ["short", "some-other-package"];
const sources = ["root", "workspace", "transitive", "scoped-override"] as const;
const lockfiles = ["bun.lock", "bun.lockb", "package-lock.json", "yarn.lock"] as const;
const actions: Record<string, string[]> = {
  "install (in sync)": ["install"],
  "add kept@^1.0.0": ["add", "kept@^1.0.0"],
  "add extra": ["add", "extra"],
  update: ["update"],
};

function registryPackages(): Pkg[] {
  return [
    { name: "kept", version: "1.0.0" },
    { name: "short", version: "1.0.0" },
    { name: "some-other-package", version: "1.0.0" },
    { name: "extra", version: "1.0.0", dependencies: { kept: "^1.0.0" } },
    { name: "parent", version: "1.0.0", dependencies: { kept: "^1.0.0" } },
    { name: "has-alias-short", version: "1.0.0", dependencies: { kept: "npm:short@1.0.0" } },
    { name: "has-alias-some-other-package", version: "1.0.0", dependencies: { kept: "npm:some-other-package@1.0.0" } },
  ];
}

function projectFiles(source: (typeof sources)[number], target: string): Record<string, string> {
  const alias = `npm:${target}@1.0.0`;
  switch (source) {
    case "root":
      return { "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { kept: alias } }) };
    case "workspace":
      return {
        "package.json": JSON.stringify({ name: "app", version: "1.0.0", workspaces: ["packages/*"] }),
        "packages/ws/package.json": JSON.stringify({ name: "ws", version: "1.0.0", dependencies: { kept: alias } }),
      };
    case "transitive":
      return {
        "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { [`has-alias-${target}`]: "1.0.0" } }),
      };
    case "scoped-override":
      return {
        "package.json": JSON.stringify({
          name: "app",
          version: "1.0.0",
          dependencies: { parent: "1.0.0" },
          overrides: { parent: { kept: alias } },
        }),
      };
  }
}

function writeFiles(dir: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
}

let caches = 0;
async function run(binary: string, cwd: string, args: string[]) {
  const proc = Bun.spawn({
    cmd: [binary, ...args],
    cwd,
    env: {
      PATH: process.env.PATH!,
      HOME: cwd,
      BUN_INSTALL_CACHE_DIR: join(cwd, `.cache-${caches++}`),
      NO_COLOR: "1",
      BUN_DEBUG_QUIET_LOGS: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

type Rows = Record<string, [string, string?, { dependencies?: Record<string, string> }?, string?]>;
function readRows(cwd: string): { rows: Rows; lock: any } | undefined {
  const path = join(cwd, "bun.lock");
  if (!existsSync(path)) return undefined;
  const lock = Bun.JSONC.parse(readFileSync(path, "utf8")) as any;
  return { rows: lock.packages ?? {}, lock };
}

const idName = (id: string) => id.slice(0, id.lastIndexOf("@"));
const idVersion = (id: string) => id.slice(id.lastIndexOf("@") + 1);

function toPackageLock(cwd: string, rows: Rows, registry: Awaited<ReturnType<typeof serve>>) {
  const root = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
  const packages: Record<string, any> = { "": root };
  for (const [key, row] of Object.entries(rows)) {
    const path = "node_modules/" + key.split("/").join("/node_modules/");
    const id = row[0];
    if (id.includes("@workspace:")) {
      const dir = id.slice(id.indexOf("@workspace:") + "@workspace:".length);
      packages[path] = { resolved: dir, link: true };
      packages[dir] = JSON.parse(readFileSync(join(cwd, dir, "package.json"), "utf8"));
      continue;
    }
    const real = idName(id);
    const installedAs = key.split("/").at(-1)!;
    packages[path] = {
      ...(installedAs !== real && { name: real }),
      version: idVersion(id),
      resolved: registry.tarballUrl(real),
      integrity: registry.integrity(real),
      ...(row[2]?.dependencies && { dependencies: row[2].dependencies }),
    };
  }
  return JSON.stringify({ name: root.name, version: root.version, lockfileVersion: 3, requires: true, packages }, null, 2);
}

function toYarnLock(cwd: string, rows: Rows, lock: any, registry: Awaited<ReturnType<typeof serve>>) {
  const resolve = (dependent: string, name: string) => {
    let at = dependent;
    for (;;) {
      const key = at ? `${at}/${name}` : name;
      if (rows[key]) return key;
      if (!at) return undefined;
      at = at.includes("/") ? at.slice(0, at.lastIndexOf("/")) : "";
    }
  };
  const entries = new Map<string, Set<string>>();
  const edge = (dependent: string, deps: Record<string, string> = {}) => {
    for (const [name, spec] of Object.entries(deps)) {
      if (spec.startsWith("workspace:")) continue;
      const key = resolve(dependent, name);
      if (!key || rows[key][0].includes("@workspace:")) continue;
      if (!entries.has(key)) entries.set(key, new Set());
      entries.get(key)!.add(`${name}@${spec}`);
    }
  };
  for (const [path, workspace] of Object.entries<any>(lock.workspaces)) {
    const dependent = path === "" ? "" : (workspace.name as string);
    for (const group of ["dependencies", "devDependencies", "optionalDependencies"]) edge(dependent, workspace[group]);
  }
  for (const [key, row] of Object.entries(rows)) edge(key, row[2]?.dependencies);

  let out = "# THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.\n# yarn lockfile v1\n\n";
  for (const [key, specs] of [...entries].sort()) {
    const row = rows[key];
    const real = idName(row[0]);
    out += "\n" + [...specs].map(spec => JSON.stringify(spec)).join(", ") + ":\n";
    out += `  version "${idVersion(row[0])}"\n`;
    out += `  resolved "${registry.tarballUrl(real)}#0123456789abcdef0123456789abcdef01234567"\n`;
    out += `  integrity ${registry.integrity(real)}\n`;
    const deps = row[2]?.dependencies;
    if (deps && Object.keys(deps).length) {
      out += "  dependencies:\n";
      for (const [name, spec] of Object.entries(deps)) out += `    ${name} "${spec}"\n`;
    }
  }
  return out;
}

async function cell(which: string, lockfile: (typeof lockfiles)[number], source: (typeof sources)[number], action: string, target: string) {
  const registry = await serve(registryPackages());
  const dir = mkdtempSync("/tmp/meas/cell-");
  try {
    writeFiles(dir, {
      ...projectFiles(source, target),
      "bunfig.toml": `[install]\nregistry = "${registry.url}"\nsaveTextLockfile = ${lockfile !== "bun.lockb"}\n`,
    });
    const binary = BINARIES[which];
    const first = await run(binary, dir, ["install", "--lockfile-only"]);
    if (first.exitCode !== 0) return { skipped: "first install failed: " + first.stderr.slice(0, 200) };
    if (lockfile === "package-lock.json" || lockfile === "yarn.lock") {
      const read = readRows(dir)!;
      writeFileSync(
        join(dir, lockfile),
        lockfile === "yarn.lock" ? toYarnLock(dir, read.rows, read.lock, registry) : toPackageLock(dir, read.rows, registry),
      );
      rmSync(join(dir, "bun.lock"));
    }
    registry.requests.length = 0;
    const result = await run(binary, dir, [...actions[action], "--lockfile-only", "--save-text-lockfile"]);
    const rows = readRows(dir)?.rows ?? {};
    return {
      exit: result.exitCode,
      requests: registry.requests.toSorted(),
      rows: Object.fromEntries(Object.entries(rows).map(([key, row]) => [key, row[0]])),
      errors: result.stderr
        .split("\n")
        .filter(line => /^(error|warn)/.test(line))
        .map(line => line.replaceAll(registry.origin, "<registry>")),
    };
  } finally {
    registry.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

const table: any[] = [];
for (const lockfile of lockfiles) {
  for (const source of sources) {
    if (source === "scoped-override" && (lockfile === "package-lock.json" || lockfile === "yarn.lock")) continue;
    for (const action of Object.keys(actions)) {
      for (const target of targets) {
        const base = await cell("base", lockfile, source, action, target);
        const pr = await cell("pr", lockfile, source, action, target);
        table.push({ lockfile, source, action, target, changed: JSON.stringify(base) !== JSON.stringify(pr), base, pr });
      }
    }
  }
}
writeFileSync("/tmp/meas/matrix.json", JSON.stringify(table, null, 2));
console.log(`cells: ${table.length}, changed: ${table.filter(row => row.changed).length}`);
for (const row of table) {
  console.log(`${row.changed ? "CHANGED" : "same   "} | ${row.lockfile} | ${row.source} | ${row.action} | ${row.target}`);
  if (row.changed || "skipped" in row.base) {
    console.log("   base:", JSON.stringify(row.base));
    console.log("   pr:  ", JSON.stringify(row.pr));
  }
}
