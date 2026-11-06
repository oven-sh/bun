// String.prototype stays extensible in a compiled program, but it takes no well-known symbol. A store that would add one and that every run reaches stops the build. language/string-prototype-keeps-its-members has the keys that can be added.
String.prototype[Symbol.replace] = function () { return "replaced"; };
console.log("a-b".replace("-", "+"));
export {};
/* Build errors:
error: TS100014: this assignment always throws: built-in objects are read-only in a compiled executable
*/
