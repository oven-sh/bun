/**
 * The `npm_install` ninja rule for `--package-manager=npm`:
 *
 *   <jsRuntime> npm-ci.ts <npm> <dir>
 *
 * npm cannot read bun.lock, and it reads package-lock.json only from the
 * directory of package.json. So this writes <dir>/package-lock.json from
 * <dir>/bun.lock, runs `npm ci` there, and deletes the file again. The
 * translated file has the same resolved versions and integrity hashes as
 * bun.lock, in npm's lockfileVersion 3 shape. Tarball URLs are the default
 * registry's, because bun.lock does not store them for that registry.
 *
 * Reads only built-ins, so it runs under bun or node.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REGISTRY = "https://registry.npmjs.org";

interface BunLock {
  workspaces: Record<string, WorkspaceEntry>;
  packages: Record<string, [string, string, PackageMeta, string?] | [string]>;
}
interface WorkspaceEntry {
  name: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}
interface PackageMeta {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalPeers?: string[];
  bin?: string | Record<string, string>;
  os?: string | string[];
  cpu?: string | string[];
}

/** bun.lock is JSON with trailing commas. */
function readBunLock(path: string): BunLock {
  return JSON.parse(readFileSync(path, "utf8").replace(/,(\s*[}\]])/g, "$1"));
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** `@scope/name@1.2.3` -> { name, version } */
function splitNameVersion(spec: string): { name: string; version: string } {
  const at = spec.lastIndexOf("@");
  return { name: spec.slice(0, at), version: spec.slice(at + 1) };
}

function tarballUrl(name: string, version: string): string {
  const base = name.startsWith("@") ? name.slice(name.indexOf("/") + 1) : name;
  return `${REGISTRY}/${name}/-/${base}-${version}.tgz`;
}

/** `a/@s/b/c` in bun.lock is the package c nested under @s/b under a. */
function splitKey(key: string): string[] {
  const parts: string[] = [];
  let rest = key;
  while (rest.length > 0) {
    const end = rest.startsWith("@") ? rest.indexOf("/", rest.indexOf("/") + 1) : rest.indexOf("/");
    if (end === -1) {
      parts.push(rest);
      break;
    }
    parts.push(rest.slice(0, end));
    rest = rest.slice(end + 1);
  }
  return parts;
}

function nodeModulesPath(key: string): string {
  return splitKey(key)
    .map(p => `node_modules/${p}`)
    .join("/");
}

/** The package-lock.json contents for the package.json and bun.lock in `root`. */
function packageLockFromBunLock(root: string): object {
  const lock = readBunLock(join(root, "bun.lock"));
  const rootManifest = readJson<{ name: string; version: string; workspaces?: string[] }>(join(root, "package.json"));

  const packages: Record<string, Record<string, unknown>> = {};
  const rootWorkspace = lock.workspaces[""]!;
  packages[""] = {
    name: rootManifest.name,
    version: rootManifest.version,
    ...(rootManifest.workspaces ? { workspaces: rootManifest.workspaces } : {}),
    ...(rootWorkspace.dependencies ? { dependencies: rootWorkspace.dependencies } : {}),
    ...(rootWorkspace.devDependencies ? { devDependencies: rootWorkspace.devDependencies } : {}),
    ...(rootWorkspace.optionalDependencies ? { optionalDependencies: rootWorkspace.optionalDependencies } : {}),
    ...(rootWorkspace.peerDependencies ? { peerDependencies: rootWorkspace.peerDependencies } : {}),
  };

  // Workspace packages: the folder entry, and a link entry under node_modules.
  const workspaceNames = new Map<string, string>();
  for (const [path, ws] of Object.entries(lock.workspaces)) {
    if (path === "") continue;
    const dir = path.replace(/^\.\//, "");
    workspaceNames.set(ws.name, dir);
    // npm omits `name` when it equals the folder name, and copies `license`.
    const manifest = readJson<{ license?: string }>(join(root, dir, "package.json"));
    packages[dir] = {
      ...(ws.name === dir.slice(dir.lastIndexOf("/") + 1) ? {} : { name: ws.name }),
      ...(ws.version ? { version: ws.version } : {}),
      ...(manifest.license ? { license: manifest.license } : {}),
      ...(ws.dependencies ? { dependencies: ws.dependencies } : {}),
      ...(ws.devDependencies ? { devDependencies: ws.devDependencies } : {}),
      ...(ws.optionalDependencies ? { optionalDependencies: ws.optionalDependencies } : {}),
      ...(ws.peerDependencies ? { peerDependencies: ws.peerDependencies } : {}),
    };
    packages[`node_modules/${ws.name}`] = { resolved: dir, link: true };
  }

  // npm flags a package `dev` when no prod edge reaches it, and `optional` when
  // no non-optional edge reaches it. Walk the graph both ways from the roots.
  function reachable(roots: Iterable<string>, withOptional: boolean): Set<string> {
    const seen = new Set<string>();
    const walk = (names: Iterable<string>) => {
      for (const name of names) {
        if (seen.has(name) || workspaceNames.has(name)) continue;
        const entry = lock.packages[name];
        if (entry === undefined || entry.length === 1) continue;
        seen.add(name);
        const meta = entry[2];
        walk(Object.keys(meta.dependencies ?? {}));
        if (withOptional) walk(Object.keys(meta.optionalDependencies ?? {}));
      }
    };
    walk(roots);
    return seen;
  }
  const workspaces = Object.values(lock.workspaces);
  const keys = (field: keyof WorkspaceEntry) => workspaces.flatMap(ws => Object.keys(ws[field] ?? {}));
  const prod = reachable([...keys("dependencies"), ...keys("optionalDependencies")], true);
  const nonOptional = reachable([...keys("dependencies"), ...keys("devDependencies")], false);

  const sortedKeys = Object.keys(lock.packages).sort();
  for (const key of sortedKeys) {
    const entry = lock.packages[key]!;
    if (entry.length === 1) continue; // a workspace link, written above
    const [spec, , meta, integrity] = entry;
    const { name, version } = splitNameVersion(spec);
    const leaf = splitKey(key).at(-1)!;
    // The fields, in the order npm writes them.
    const out: Record<string, unknown> = { version, resolved: tarballUrl(name, version) };
    if (integrity) out.integrity = integrity;
    if (meta.cpu) out.cpu = Array.isArray(meta.cpu) ? meta.cpu : [meta.cpu];
    if (!prod.has(key) && !prod.has(leaf)) out.dev = true;
    if (!nonOptional.has(key) && !nonOptional.has(leaf)) out.optional = true;
    if (meta.os) out.os = Array.isArray(meta.os) ? meta.os : [meta.os];
    if (meta.dependencies) out.dependencies = meta.dependencies;
    if (meta.bin) out.bin = typeof meta.bin === "string" ? { [name.replace(/^@[^/]+\//, "")]: meta.bin } : meta.bin;
    if (meta.optionalDependencies) out.optionalDependencies = meta.optionalDependencies;
    if (meta.peerDependencies) out.peerDependencies = meta.peerDependencies;
    if (meta.optionalPeers) {
      out.peerDependenciesMeta = Object.fromEntries(meta.optionalPeers.map(p => [p, { optional: true }]));
    }
    packages[nodeModulesPath(key)] = out;
  }

  // npm writes the root entry first, then the rest sorted by path.
  const { "": rootEntry, ...rest } = packages;
  const output = {
    name: rootManifest.name,
    version: rootManifest.version,
    lockfileVersion: 3,
    requires: true,
    packages: { "": rootEntry, ...Object.fromEntries(Object.entries(rest).sort(([a], [b]) => (a < b ? -1 : 1))) },
  };
  return output;
}

/** Runs npm with the given arguments in `dir` and returns its exit code. */
function npm(exe: string, args: string[], dir: string): number {
  // npm is a batch file on Windows, so it needs a shell there. The shell
  // joins the command line without quotes, so quote a path with spaces.
  const windows = process.platform === "win32";
  const result = spawnSync(windows ? `"${exe}"` : exe, args, { cwd: dir, stdio: "inherit", shell: windows });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function main(): void {
  const [exe, dir] = process.argv.slice(2);
  if (!exe || !dir) {
    console.error("usage: npm-ci.ts <npm> <dir>");
    process.exit(1);
  }
  const lockPath = join(dir, "package-lock.json");
  writeFileSync(lockPath, JSON.stringify(packageLockFromBunLock(dir), null, 2) + "\n");
  let status: number;
  try {
    status = npm(exe, ["ci", "--include=dev", "--no-audit", "--no-fund"], dir);
  } finally {
    rmSync(lockPath, { force: true });
  }
  if (status !== 0) {
    process.exitCode = status;
    return;
  }
  // `npm ci` runs install scripts only for packages the lockfile flags with
  // hasInstallScript, which bun.lock does not record. `npm rebuild` reads
  // the real package.json files, but only when no lockfile is left, not even
  // npm's own copy under node_modules.
  rmSync(join(dir, "node_modules", ".package-lock.json"), { force: true });
  process.exitCode = npm(exe, ["rebuild", "--no-audit", "--no-fund"], dir);
}

main();
