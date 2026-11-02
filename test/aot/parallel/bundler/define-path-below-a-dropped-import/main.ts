// A `--define` whose value is a dotted path is a use of the import that has its first name: the import stays, its module runs and the path reads a member of it. Under `bun run` TypeScript drops an import that nothing else in the file reads, and the path finds no variable. Plain Bun prints another output.
// Flags: --define process.env.ALIAS=holder.member
import { holder } from "./lib.mjs";
console.log(process.env.ALIAS);
/* Output:
lib loaded
1
*/
