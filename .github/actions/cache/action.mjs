import { getInput, getMultilineInput } from "@actions/core";
import { restoreCache as restoreGithubCache, saveCache as saveGithubCache } from "@actions/cache";
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const path = getInput("path", { required: true });
const key = getInput("key", { required: true });
const restoreKeys = getMultilineInput("restore-keys");
const cacheDir = getInput("cache-dir") || join(tmpdir(), ".github", "cache");
console.log("Received inputs:", { path, key, restoreKeys, cacheDir });

export async function restoreCache() {
  if (isGithubHosted()) {
    console.log("Using GitHub cache...");
    const cacheKey = await restoreGithubCache([path], key, restoreKeys);
    return {
      cacheHit: !!cacheKey,
      cacheKey: cacheKey ?? key,
    };
  }

  console.log("Using local cache...", cacheDir);
  if (!existsSync(cacheDir)) {
    console.log("Cache directory does not exist, creating it...");
    mkdirSync(cacheDir, { recursive: true });
  }

  const cacheEntry = join(cacheDir, key);
  if (existsSync(cacheEntry)) {
    console.log("Found cache directory, restoring...", cacheEntry, "(hit)");
    copyFiles(cacheEntry, path);
    return {
      cacheHit: true,
      cacheKey: key,
    };
  }

  for (const dirname of readdirSync(cacheDir)) {
    if (!dirname.startsWith(key)) {
      continue;
    }

    const cacheEntry = join(cacheDir, dirname);
    console.log("Found cache directory, restoring...", cacheEntry, "(miss)");
    copyFiles(cacheEntry, path);
    return {
      cacheHit: false,
      cacheKey: key,
      cacheMatchedKey: dirname,
    };
  }

  console.log("No cache found...", key);
  return {
    cacheHit: false,
    cacheKey: key,
  };
}

export async function saveCache() {
  if (isGithubHosted()) {
    console.log("Using GitHub cache...");
    const cacheId = await saveGithubCache([path], key);
    return !!cacheId;
  }

  console.log("Using local cache...", cacheDir);
  if (!existsSync(cacheDir)) {
    console.log("Cache directory does not exist, creating it...");
    mkdirSync(cacheDir, { recursive: true });
  }

  const cacheEntry = join(cacheDir, key);
  console.log("Copying files to cache...", cacheEntry);
  copyFiles(path, cacheEntry);
}

function copyFiles(src, dst) {
  cpSync(src, dst, {
    recursive: true,
    force: true,
    preserveTimestamps: true,
  });
}

function isGithubHosted() {
  return process.env.RUNNER_ENVIRONMENT === "github-hosted" || process.env.RUNNER_NAME?.startsWith("nsc-runner-");
}
