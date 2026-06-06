import JSZip from "jszip";
import { spawnSync } from "node:child_process";
import { error, log, warn } from "../src/console";
import { fetch } from "../src/fetch";
import { chmod, exists, hash, join, rm, tmp, write } from "../src/fs";
import { getRelease, github, uploadAsset } from "../src/github";

// Publishes the delta-update assets that `bun upgrade` consumes:
//
//   bun-<target>.from-<prev>.bsdiff            zstd-compressed bsdiff patch
//   bun-<target>.from-<prev>.bsdiff.sha256sum  checksum of the patch
//   bun-<target>.sha256sum                     checksum of the uncompressed binary
//
// Each release gets one patch per target, from its immediate predecessor;
// `bun upgrade` chains patches when it is more than one release behind. The
// previous release also gets a `bun-<target>.sha256sum` (if missing) so
// binaries installed from it can verify themselves before patching.

const [tag] = process.argv.slice(2);

if (!tag) {
  error("Invalid arguments: [tag]");
  process.exit(1);
}

function parseStableVersion(tagName: string): [number, number, number] | null {
  const match = /^bun-v(\d+)\.(\d+)\.(\d+)$/.exec(tagName);
  if (!match) {
    return null;
  }
  return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
}

function compareVersions(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

const release = await getRelease(tag);
const version = parseStableVersion(release.tag_name);
if (!version) {
  log("Skipping delta patches for non-stable release:", release.tag_name, "\n");
  process.exit(0);
}

// Find the immediate predecessor among stable releases.
const releases = await github("GET /repos/{owner}/{repo}/releases", {
  per_page: 100,
});
let previous: { tag_name: string; version: [number, number, number] } | undefined;
for (const { tag_name } of releases) {
  const candidate = parseStableVersion(tag_name);
  if (!candidate || compareVersions(candidate, version) >= 0) {
    continue;
  }
  if (!previous || compareVersions(candidate, previous.version) > 0) {
    previous = { tag_name, version: candidate };
  }
}
if (!previous) {
  log("No previous stable release found, skipping delta patches\n");
  process.exit(0);
}
const previousRelease = await getRelease(previous.tag_name);
const previousVersion = previous.tag_name.replace(/^bun-v/, "");
log("Release:", release.tag_name, "\n");
log("Previous:", previousRelease.tag_name, "\n");

// Patches are published for the standard binaries only (not -profile, which
// `bun upgrade` always downloads in full).
function isDeltaTarget(name: string): boolean {
  return /^bun-[a-z0-9-]+\.zip$/.test(name) && !name.includes("-profile") && !name.includes("-asan");
}

async function extractBinary(url: string, assetName: string): Promise<Buffer | null> {
  const response = await fetch(url);
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  const folder = assetName.replace(/\.zip$/, "");
  const file = zip.file(`${folder}/bun`) ?? zip.file(`${folder}/bun.exe`);
  if (!file) {
    return null;
  }
  return file.async("nodebuffer");
}

// The freshly-released binary generates the patches (via its
// `bun:internal-for-testing` bindings), so this script does not depend on
// the runner's installed version of Bun.
const cwd = tmp();
const generator = join(cwd, "bun");
{
  const hostAsset = release.assets.find(({ name }) => name === "bun-linux-x64.zip");
  if (!hostAsset) {
    error("Release has no bun-linux-x64.zip to generate patches with");
    process.exit(1);
  }
  const binary = await extractBinary(hostAsset.browser_download_url, hostAsset.name);
  if (!binary) {
    error("bun-linux-x64.zip does not contain a bun binary");
    process.exit(1);
  }
  write(generator, binary);
  chmod(generator, 0o755);
}

function createDeltaPatch(oldPath: string, newPath: string, patchPath: string): boolean {
  const { status, stderr } = spawnSync(
    generator,
    [
      "-e",
      `const { upgrade_test_helpers } = require("bun:internal-for-testing");
       const fs = require("node:fs");
       try {
         fs.writeFileSync(
           process.env.DELTA_OUT,
           upgrade_test_helpers.createDeltaPatch(
             fs.readFileSync(process.env.DELTA_OLD),
             fs.readFileSync(process.env.DELTA_NEW),
           ),
         );
       } catch (cause) {
         console.error(cause?.message ?? cause);
         process.exit(1);
       }`,
    ],
    {
      env: {
        ...process.env,
        // Release builds only read BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING when
        // BUN_GARBAGE_COLLECTOR_LEVEL is also present (a startup optimization
        // that skips obscure env lookups); "0" leaves GC behavior unchanged.
        BUN_GARBAGE_COLLECTOR_LEVEL: "0",
        BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1",
        DELTA_OLD: oldPath,
        DELTA_NEW: newPath,
        DELTA_OUT: patchPath,
      },
      stdio: ["ignore", "inherit", "pipe"],
    },
  );
  if (status !== 0) {
    warn("Failed to generate patch:", stderr?.toString() ?? `exit code ${status}`);
    return false;
  }
  // Don't trust the exit code alone: verify a non-empty patch was written.
  if (!exists(patchPath) || Bun.file(patchPath).size === 0) {
    warn("Failed to generate patch: no output was written");
    return false;
  }
  return true;
}

const targets = release.assets.filter(({ name }) => isDeltaTarget(name));
log("Targets:\n", ...targets.map(({ name }) => `- ${name}\n`));

let failures = 0;
for (const asset of targets) {
  const base = asset.name.replace(/\.zip$/, "");
  const previousAsset = previousRelease.assets.find(({ name }) => name === asset.name);
  if (!previousAsset) {
    log("Skipping", base, "(not present in the previous release)\n");
    continue;
  }

  try {
    const oldBinary = await extractBinary(previousAsset.browser_download_url, previousAsset.name);
    const newBinary = await extractBinary(asset.browser_download_url, asset.name);
    if (!oldBinary || !newBinary) {
      // Both archives exist, so a missing binary means the standard layout
      // changed; that must fail the job, not silently skip the platform.
      warn("No binary found in the", base, "archives\n");
      failures++;
      continue;
    }

    const oldPath = join(cwd, `${base}-old`);
    const newPath = join(cwd, `${base}-new`);
    const patchName = `${base}.from-${previousVersion}.bsdiff`;
    const patchPath = join(cwd, patchName);
    write(oldPath, oldBinary);
    write(newPath, newBinary);

    log("Generating", patchName, "\n");
    if (!createDeltaPatch(oldPath, newPath, patchPath)) {
      failures++;
      continue;
    }

    const patchHash = hash(patchPath);
    log("Uploading", patchName, `(${patchHash})\n`);
    await uploadAsset(tag, patchName, new Blob([await Bun.file(patchPath).arrayBuffer()]));
    await uploadAsset(tag, `${patchName}.sha256sum`, new Blob([`${patchHash}  ${patchName}\n`]));
    await uploadAsset(tag, `${base}.sha256sum`, new Blob([`${hash(newBinary)}  ${base}\n`]));

    // Let binaries installed from the previous release verify themselves.
    if (!previousRelease.assets.some(({ name }) => name === `${base}.sha256sum`)) {
      await uploadAsset(previous.tag_name, `${base}.sha256sum`, new Blob([`${hash(oldBinary)}  ${base}\n`]));
    }

    rm(oldPath);
    rm(newPath);
    rm(patchPath);
  } catch (cause) {
    warn("Failed to publish a delta patch for", base, "\n", cause);
    failures++;
  }
}

if (failures > 0) {
  error(`Failed to publish ${failures} delta patch(es)`);
  process.exit(1);
}
log("Done\n");
