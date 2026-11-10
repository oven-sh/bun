// Built-in objects and a symbol key are passed to a function as arguments.
function read(object, key) {
  return object[key];
}
console.log(read(globalThis, Symbol.for("made.up")), read(process, Symbol.for("made.up")));
