// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { $ } from "bun";
console.log((await $`echo imported`.text()).trim());
