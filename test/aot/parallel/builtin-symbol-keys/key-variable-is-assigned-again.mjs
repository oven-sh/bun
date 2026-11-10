// The variable first holds a symbol and holds the name of eval when it is read.
let key = Symbol.for("made.up");
function change() { key = ["ev", "al"].join(""); }
change();
console.log(globalThis[key]("1 + 1"));
