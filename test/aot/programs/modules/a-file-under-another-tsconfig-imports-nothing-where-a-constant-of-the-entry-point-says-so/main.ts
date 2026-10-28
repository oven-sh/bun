// strict/ has a tsconfig.json whose compiler options are not the program's. A constant of the entry point, true because the program starts with it, decides there that an `import()` never runs, so the executable does not hold the file that it names.
import { load, loadOther } from "./strict/loader.ts";

export const IS_MAIN = import.meta.main;

console.log(IS_MAIN, await load(), await loadOther());
