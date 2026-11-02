// A `--define` whose value is one name is a use of the import of that name, also in a statement that is the name alone. The name is a type here, and its file exports no such value: the build stops at the import, as it does where the name itself is written. `bun run` removes the statement, drops the name from the import and runs both files.
// Flags: --define NAME=Shape
import { Shape } from "./types";
declare const NAME: any;
NAME;
console.log("end");
/* Plain Bun prints:
types loaded
end
*/
/* Build errors:
error: TS100200: No matching export in "types.ts" for import "Shape"
*/
