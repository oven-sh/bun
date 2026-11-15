// A name that is used once, in the statement behind its declaration: the transpiler puts `require` back in its place, and reads the name in that call.
function read() {
  const load = require;
  return typeof load("bun:os").EOL;
}
console.log(read());
