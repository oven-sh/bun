import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { getInput, setOutput } from "@actions/core";

const paths = getInput("paths", { required: true });

function getCacheKey() {
  const { error, status, stdout, stderr } = spawnSync("git", ["ls-files", "-s", ...paths], {
    encoding: "utf-8",
    stdio: "pipe",
  });
  if (error) {
    throw error;
  }
  if (status !== 0) {
    throw new Error(`git ls-files failed: ${stderr}`);
  }
  return createHash("sha256").update(stdout).digest("hex");
}

function main() {
  const cacheKey = getCacheKey();
  console.log("Cache key:", cacheKey);
  setOutput("cache-key", cacheKey);
}

main();
