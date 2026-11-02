// A `--define` whose value is one name that the file imports reads the import, and the module that exports it runs. The default export of "node:process" is the global `process`, so a path below it is read as it is from the global.
// Flags: --define NAME=named --define ALL=everything --define MAIN=main --define import.meta.env.MODE=named --define SETTING=process.env.SETTING
// Env: SETTING=from the environment
import process from "node:process";
import main, { named } from "./exports.mjs";
import * as everything from "./exports.mjs";

globalThis.named = "the global";
console.log(NAME, MAIN, typeof ALL, ALL.named === NAME, ALL.default === MAIN);
console.log(import.meta.env.MODE, SETTING, process.env.SETTING);
