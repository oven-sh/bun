// The key is a symbol on one path and the name of eval on the other.
const key = process.argv.length > 99 ? Symbol.for("made.up") : ["ev", "al"].join("");
console.log(globalThis[key]("1 + 1"));
