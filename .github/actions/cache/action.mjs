import { getInput, getMultilineInput } from "@actions/core";
import { restoreCache as restoreGithubCache, saveCache as saveGithubCache } from "@actions/cache";
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const path = getInput("path", { required: true });
const key = getInput("key", { required: true });
const restoreKeys = getMultilineInput("restore-keys");
const cacheDir = getInput("cache-dir") || join(tmpdir(), ".github", "cache");

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
  // if (!existsSync(cacheDir)) {
  //   console.log("Cache directory does not exist, creating it...");
  //   try {
  //     mkdirSync(cacheDir, { recursive: true });
  //   } catch (error) {
  //     console.log("Failed to create cache directory:", error);
  //     return null;
  //   }
  // }

  const targetDir = join(cacheDir, key);
  if (existsSync(targetDir)) {
    console.log("Found cache directory, restoring...", targetDir, "(hit)");
    copyFiles(targetDir, path);
    return {
      cacheHit: true,
      cacheKey: key,
    };
  }

  for (const dirname of readdirSync(cacheDir)) {
    if (!dirname.startsWith(key)) {
      continue;
    }

    const targetDir = join(cacheDir, dirname);
    console.log("Found cache directory, restoring...", targetDir, "(miss)");
    copyFiles(targetDir, path);
    return {
      cacheHit: false,
      cacheKey: dirname,
    };
  }

  return {
    cacheHit: false,
    cacheKey: key,
  };
}

export async function saveCache() {
  if (isGithubHosted()) {
    console.log("Using GitHub cache...");
    try {
      const cacheId = await saveGithubCache([path], key);
      return !!cacheId;
    } catch (error) {
      console.log("Failed to save cache:", error);
      return false;
    }
  }

  console.log("Using local cache...");
  if (!existsSync(cacheDir)) {
    console.log("Cache directory does not exist, creating it...", cacheDir);
    try {
      mkdirSync(cacheDir, { recursive: true });
    } catch (error) {
      console.log("Failed to create cache directory:", error);
      return false;
    }
  }

  const targetDir = join(cacheDir, key);
  console.log("Copying files to cache...", targetDir);
  try {
    copyFiles(path, targetDir);
  } catch (error) {
    console.log("Failed to copy files to cache:", error);
    return false;
  }

  return true;
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
