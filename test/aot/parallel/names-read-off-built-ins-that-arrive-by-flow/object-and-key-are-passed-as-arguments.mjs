function read(object, key) {
  return object[key];
}
console.log(read(globalThis, Symbol.for("made.up")), read(process, Symbol.for("made.up")));
