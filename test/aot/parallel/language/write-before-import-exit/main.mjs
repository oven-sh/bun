// The import that writes to a locked built-in comes first, so every run reaches the write: a build error.
import "./patch.mjs";
import "./exit.mjs";
console.log("never");
/* Build errors:
error: TS100014: this assignment always throws: built-in objects are read-only in a compiled executable
*/
