import { setOutput } from "@actions/core";
import { restoreCache } from "../action.mjs";

async function main() {
  const { cacheHit, cacheKey, cacheMatchedKey } = await restoreCache();
  setOutput("cache-hit", cacheHit);
  setOutput("cache-primary-key", cacheKey);
  setOutput("cache-matched-key", cacheMatchedKey ?? cacheKey);
}

main().catch(error => {
  console.error("Failed to restore cache:", error);
  process.exit(1);
});
