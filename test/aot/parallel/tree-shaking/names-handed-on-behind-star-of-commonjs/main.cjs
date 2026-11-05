const required = require("./barrel.mjs");
try {
  console.log("at first", [required.c].length + String(required.c));
} catch (error) {
  console.log("at first", "THROWS", error instanceof TypeError ? "TypeError" : error instanceof ReferenceError ? "ReferenceError" : typeof error);
}
try {
  console.log("which", required.which);
} catch (error) {
  console.log("which", "THROWS", error instanceof TypeError ? "TypeError" : error instanceof ReferenceError ? "ReferenceError" : typeof error);
}
try {
  console.log("change", required.change());
} catch (error) {
  console.log("change", "THROWS", error instanceof TypeError ? "TypeError" : error instanceof ReferenceError ? "ReferenceError" : typeof error);
}
try {
  console.log("changed", required.c);
} catch (error) {
  console.log("changed", "THROWS", error instanceof TypeError ? "TypeError" : error instanceof ReferenceError ? "ReferenceError" : typeof error);
}
try {
  console.log("lazy", typeof (required.lazy().c));
} catch (error) {
  console.log("lazy", "THROWS", error instanceof TypeError ? "TypeError" : error instanceof ReferenceError ? "ReferenceError" : typeof error);
}
console.log("keys", Object.keys(required).sort().join());
console.log("ran", (globalThis.ran ?? []).sort().join(), "seen", globalThis.seen);
