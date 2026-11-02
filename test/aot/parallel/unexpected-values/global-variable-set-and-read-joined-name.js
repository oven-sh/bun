// A global variable is set and read under a joined name.
const name = ["a", "b"].join("");
globalThis[name] = 1;
console.log(globalThis[name]);
