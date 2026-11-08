// "bun:bundle" has no default export. Plain Bun refuses the import with the same words.
import flags from "bun:bundle";
console.log(flags.feature("EXTRA_TOOLS") ? "on" : "off");
/* Build errors:
error: TS100105: "bun:bundle" has no export named "default"
*/
