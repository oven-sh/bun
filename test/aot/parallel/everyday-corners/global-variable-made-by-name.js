// Global variable made by name: compiled answers as plain.
globalThis["made" + "Up"] = 1;
function f() {
  return typeof madeUp === "undefined" ? "none" : madeUp + 1;
}
console.log(f());
delete globalThis.madeUp;
console.log(f());
