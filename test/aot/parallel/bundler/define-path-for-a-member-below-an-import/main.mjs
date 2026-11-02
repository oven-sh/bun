// A `--define` of `process.env.ALIAS` whose value is a dotted path reads a member of an import that nothing else in the module reads.
// Flags: --define process.env.ALIAS=holder.member
import { holder } from "./lib.mjs";
console.log(process.env.ALIAS);
