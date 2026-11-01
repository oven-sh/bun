// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
console.log(typeof require("node:os").EOL, typeof require.resolve);
