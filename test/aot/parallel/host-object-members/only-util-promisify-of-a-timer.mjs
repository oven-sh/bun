// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { promisify } from "node:util";
console.log(await promisify(setTimeout)(1, "promisified"));
