// Inside a namespace an exported member of the namespace is no variable, so a `--define` whose value is its name reads the import of that name. `bun run` counts no use of the import there, and TypeScript drops an import that nothing uses: the build stops at such a name.
// Flags: --define NAME=target
import { target } from "./lib.mjs";
declare const NAME: any;
(globalThis as any).target = "the global";
namespace Holder {
  export const target = "the member of the namespace";
  export const seen = NAME;
}
console.log(Holder.seen);
/* Build errors:
error: TS100050: --aot does not support --define NAME=target where "target" is an import that the file uses nowhere else. The value is read as a name. A string needs quotes: --define 'NAME="target"'
*/
