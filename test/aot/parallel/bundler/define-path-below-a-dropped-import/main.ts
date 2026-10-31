// TypeScript drops an import that nothing in the file reads, and under `bun run` a `--define` whose value is a dotted path is no such read: the path finds no variable. The build stops at the path.
// Flags: --define process.env.ALIAS=holder.member
import { holder } from "./lib.mjs";
console.log(process.env.ALIAS);
/* Build errors:
error: TS100050: --aot does not support --define process.env.ALIAS=holder.member where "holder" is an import that the file uses nowhere else. The value is read as a name. A string needs quotes: --define 'process.env.ALIAS="holder.member"'
*/
