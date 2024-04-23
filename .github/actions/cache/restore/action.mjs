import { setOutput } from "@actions/core";
import { restoreCache } from "../action.mjs";

async function main() {
  const { cacheHit, cacheKey, cacheMatchedKey } = await restoreCache();
  const outputs = {
    "cache-hit": cacheHit,
    "cache-primary-key": cacheKey,
    "cache-matched-key": cacheMatchedKey ?? cacheKey,
  };
  for (const [key, value] of Object.entries(outputs)) {
    setOutput(key, value);
  }
  console.log("Set outputs:", outputs);
}

main().catch(error => {
  console.error("Failed to restore cache:", error);
  process.exit(1);
});
