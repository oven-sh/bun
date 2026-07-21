#!/usr/bin/env node
// Pipeline entry point invoked by the Buildkite `:pipeline:` step
// (`node .buildkite/ci.mjs`). Plain JavaScript, no .ts imports, so it starts
// under whatever node the CI agent happens to have installed.
//
// Its one job: make the spec-pinned Node.js available (download + cache on
// first use) and re-run the real pipeline generator, .buildkite/ci.ts,
// under it. ci.ts is TypeScript that imports the CI image system's .ts
// modules, which only a modern node (built-in type stripping, >= 25) can
// load — the agent's own node is never trusted for that. There is no
// fallback: if the pinned node can't be obtained, generation fails loudly.
//
// The fetch/cache logic is shared with .buildkite/generate-pipeline.sh (the
// eventual direct entry point once every branch carries this system); the
// version comes from scripts/build/ci/spec.ts, so there is one place to
// bump it.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

/** The pinned node version: `nodejs.version` in the image spec (single
 * source of truth — the same node baked onto every CI image). */
function specNodeVersion() {
  const specPath = join(repoRoot, "scripts", "build", "ci", "spec.ts");
  const spec = readFileSync(specPath, "utf8");
  const block = spec.match(/export const nodejs[\s\S]*?version:\s*"([\d.]+)"/);
  if (!block) {
    throw new Error(`could not read nodejs.version from ${specPath}`);
  }
  return block[1];
}

function nodePlatform() {
  switch (process.platform) {
    case "linux":
      return "linux";
    case "darwin":
      return "darwin";
    default:
      throw new Error(`unsupported OS for pipeline generation: ${process.platform}`);
  }
}

function nodeCpu() {
  switch (process.arch) {
    case "x64":
      return "x64";
    case "arm64":
      return "arm64";
    default:
      throw new Error(`unsupported CPU for pipeline generation: ${process.arch}`);
  }
}

/** Return the path to the pinned node, downloading and caching it if
 * needed. Cache dir matches generate-pipeline.sh so both share one copy. */
function ensurePinnedNode(version) {
  const folder = `node-v${version}-${nodePlatform()}-${nodeCpu()}`;
  const cacheDir = join(homedir() || tmpdir(), ".cache", "bun-ci-node");
  const nodeBin = join(cacheDir, folder, "bin", "node");
  if (existsSync(nodeBin)) {
    return nodeBin;
  }

  const url = `https://nodejs.org/dist/v${version}/${folder}.tar.gz`;
  console.log(`--- Fetching Node.js ${version} for the pipeline generator (${nodePlatform()} ${nodeCpu()})`);
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
  return nodeBin;
}

const version = specNodeVersion();
const nodeBin = ensurePinnedNode(version);
console.log(`--- Generating pipeline with node ${version} (spec-pinned; agent's own node not used)`);
const generator = spawnSync(nodeBin, [join(here, "ci.ts"), ...process.argv.slice(2)], {
  stdio: "inherit",
  cwd: repoRoot,
});
process.exit(generator.status === null ? 1 : generator.status);
