// The call whose text comes first fails before the other one's has come: its require() gets the same error. The other one's runs the file. Which text comes first is not settled.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const get = async () => (await import("./flaky.cjs")).default;
async function load() {
  try {
    return "imported " + (await get()).value;
  } catch (error) {
    try {
      return "rejected with " + error.message + ", required " + require("./flaky.cjs").value;
    } catch (error) {
      return "failed: " + error.message;
    }
  }
}
await new Promise((resolve) => setImmediate(resolve));
console.log((await Promise.all([load(), load()])).sort().join("\n"));
console.log("runs", globalThis.runs);
