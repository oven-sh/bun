for (const name in "ab") { }
Object.keys = function () { return []; };
/* Build errors:
error: TS100014: this assignment always throws: built-in objects are read-only in a compiled executable
*/
