// As ../in-a-data-url, and the code stands behind an object URL.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { startFromBlob } from "../lib/starts.mjs";
console.log(await startFromBlob());
