// The function reads the constant in its temporal dead zone: the read throws and no key is looked up.
function read() {
  return globalThis[key];
}
try {
  read();
} catch (error) {
  console.log(error.name);
}
const key = Symbol.for("made.up.late");
globalThis[key] = "stored";
console.log(read());
