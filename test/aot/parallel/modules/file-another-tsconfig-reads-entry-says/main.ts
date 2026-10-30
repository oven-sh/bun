// strict/ has a tsconfig.json whose compiler options are not the program's. Its files import constants of the entry point that hang on which file the program starts with.
// Alone: it asks which file the executable was started as (import.meta.main, require.main)
import { describe } from "./strict/reader.ts";
import { describeThroughOtherFiles } from "./strict/reader-of-other-files.ts";

export const IS_MAIN = import.meta.main;
export const IS_NOT_MAIN = !import.meta.main;
export const IS_REQUIRED_FIRST = require.main === module;
export const KIND = import.meta.main ? "the entry point" : "an imported file";
export const pick = import.meta.main ? () => "picked as the entry point" : () => "picked as an imported file";

console.log(IS_MAIN, IS_NOT_MAIN, IS_REQUIRED_FIRST, KIND);
console.log(describe());
console.log(describeThroughOtherFiles());
