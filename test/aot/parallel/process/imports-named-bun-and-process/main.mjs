// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import process, { Bun } from "./mine.mjs";
import * as globalThis from "./mine.mjs";
console.log(
  process.isBun ? "bun" : "other",
  typeof Bun === "undefined" ? "other" : "bun",
  "bun" in process.versions,
  globalThis.Bun,
  typeof globalThis.process,
);
