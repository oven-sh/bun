// "bun:bundle" is gone when the program runs, so a namespace of it has nothing to name. Plain Bun refuses the import with the same words.
import * as flags from "bun:bundle";
console.log(flags.feature("EXTRA_TOOLS") ? "on" : "off");
/* Build errors:
error: TS100115: "bun:bundle" cannot be imported as a namespace
*/
