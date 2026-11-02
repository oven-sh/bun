// A `--define` whose value is one name reads the import of that name, which nothing else in the TypeScript file reads: the import stays and its module runs.
// Flags: --define NAME=holder
import { holder } from "./lib.mjs";
declare const NAME: { member: number };
console.log(NAME.member);
