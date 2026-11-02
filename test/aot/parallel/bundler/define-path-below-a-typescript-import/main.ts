// A `--define` whose value is a dotted path reads a member of an import of the TypeScript file, which the file also reads by its own name.
// Flags: --define process.env.ALIAS=holder.member
import { holder } from "./lib.mjs";
console.log(process.env.ALIAS, typeof holder);
