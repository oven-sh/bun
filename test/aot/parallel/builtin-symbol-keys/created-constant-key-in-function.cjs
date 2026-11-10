// The key is a symbol that the module makes once, read in a function of a CommonJS file.
const key = Symbol("made up");
function read() { return globalThis[key]; }
console.log(read());
