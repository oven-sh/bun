// typeof of an undeclared global does not throw, so a write to a locked built-in after it is still a build error.
console.log(typeof undeclaredName, typeof window, typeof process);
Array.prototype.push = function () {};
/* Build errors:
error: TS100014: this assignment always throws: built-in objects are read-only in a compiled executable
*/
