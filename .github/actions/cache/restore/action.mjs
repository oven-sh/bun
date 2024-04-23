import { setOutput } from "@actions/core";
import { restoreCache } from "../action.mjs";

async function main() {
  try {
    const result = await restoreCache();
    if (result) {
      const { cacheHit, cacheKey } = result;
      console.log("Cache key:", cacheKey, cacheHit ? "(hit)" : "(miss)");
      setOutput("cache-hit", cacheHit);
      setOutput("cache-matched-key", cacheKey);
      if (cacheHit) {
        setOutput("cache-primary-key", cacheKey);
      }
      return;
    }
  } catch (error) {
    console.error("Failed to restore cache:", error);
  }
  process.exit(1);
}

main();
