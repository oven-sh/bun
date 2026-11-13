for (const name in Math) { }
Object.keys = function () { return []; };
/* Build errors:
error: TS100014: this assignment always throws: built-in objects are read-only in a compiled executable
*/
