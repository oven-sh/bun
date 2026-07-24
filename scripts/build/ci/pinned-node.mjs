// Run a TypeScript entry point under the spec-pinned Node.js, regardless of
// the node this process happens to be running under.
//
// The CI image system is TypeScript executed by bare node (built-in type
// stripping, node >= 25). The Buildkite agents that invoke it (the standing
// pipeline agent and the ephemeral bake agents) carry a node whose version
// nothing in this repo controls — so no entry point trusts it. Instead each
// entry point (.buildkite/ci.mjs, scripts/machine.mjs) is a tiny plain-JS
// wrapper that calls execUnderPinnedNode(): it reads nodejs.version from
// scripts/build/ci/spec.ts, downloads exactly that Node.js for the running
// host (cached, fetched once per host), and re-runs the given .ts entry
// under it. If the pinned node cannot be obtained, this fails loudly —
// there is no fallback to the agent's own node.
//
// PLAIN JavaScript, no .ts imports: this module must load under any node.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");

/** The pinned node version: `nodejs.version` in the image spec — the single
 * source of truth, the same node baked onto every CI image. */
function specNodeVersion() {
  const specPath = join(repoRoot, "scripts", "build", "ci", "spec.ts");
  const spec = readFileSync(specPath, "utf8");
  const match = spec.match(/export const nodejs[\s\S]*?version:\s*"([\d.]+)"/);
  if (!match) {
    throw new Error(`could not read nodejs.version from ${specPath}`);
  }
  return match[1];
}

function nodePlatform() {
  switch (process.platform) {
    case "linux":
      return "linux";
    case "darwin":
      return "darwin";
    default:
      throw new Error(`unsupported OS for the CI node shim: ${process.platform}`);
  }
}

function nodeCpu() {
  switch (process.arch) {
    case "x64":
      return "x64";
    case "arm64":
      return "arm64";
    default:
      throw new Error(`unsupported CPU for the CI node shim: ${process.arch}`);
  }
}

/** Path to the pinned node binary, downloading and caching it if needed.
 * Cache dir matches .buildkite/generate-pipeline.sh so all share one copy. */
export function ensurePinnedNode() {
  const version = specNodeVersion();
  const folder = `node-v${version}-${nodePlatform()}-${nodeCpu()}`;
  const cacheDir = join(homedir() || tmpdir(), ".cache", "bun-ci-node");
  const nodeBin = join(cacheDir, folder, "bin", "node");
  if (existsSync(nodeBin)) {
    return { nodeBin, version };
  }

  const url = `https://nodejs.org/dist/v${version}/${folder}.tar.gz`;
  console.log(`--- Fetching Node.js ${version} for the CI tooling (${nodePlatform()} ${nodeCpu()})`);
  console.log(`    ${url}`);
  mkdirSync(cacheDir, { recursive: true });
  const tarball = join(cacheDir, `${folder}.tar.gz.${process.pid}`);
  const fetched = spawnSync("curl", ["-fsSL", "--retry", "5", "--retry-all-errors", url, "-o", tarball], {
    stdio: "inherit",
  });
  if (fetched.status !== 0) {
    // curl missing or the download failed — try wget before giving up.
    const wget = spawnSync("wget", ["-q", "--tries=5", "-O", tarball, url], { stdio: "inherit" });
    if (wget.status !== 0) {
      rmSync(tarball, { force: true });
      throw new Error(`failed to download ${url} (curl and wget both failed)`);
    }
  }
  const extracted = spawnSync("tar", ["-xzf", tarball, "-C", cacheDir], { stdio: "inherit" });
  rmSync(tarball, { force: true });
  if (extracted.status !== 0) {
    throw new Error(`failed to extract ${tarball}`);
  }
  if (!existsSync(nodeBin)) {
    throw new Error(`downloaded node did not contain ${nodeBin}`);
  }
  return { nodeBin, version };
}

/**
 * Replace this process's job with `node <entry.ts> ...args` under the
 * pinned node: stream its output and exit with its status. `entry` is
 * resolved relative to the repo root.
 */
export function execUnderPinnedNode(entry, args) {
  const { nodeBin, version } = ensurePinnedNode();
  const entryPath = join(repoRoot, entry);
  console.log(`--- Running ${entry} under node ${version} (spec-pinned; agent's own node not used)`);
  const child = spawnSync(nodeBin, [entryPath, ...args], { stdio: "inherit", cwd: process.cwd() });
  process.exit(child.status === null ? 1 : child.status);
}
