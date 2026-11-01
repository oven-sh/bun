import { c, change, lazy } from "a-package";
try {
  console.log("at first", c());
} catch (error) {
  console.log("at first", "THROWS", error instanceof TypeError ? "TypeError" : error instanceof ReferenceError ? "ReferenceError" : typeof error);
}
try {
  console.log("change", change());
} catch (error) {
  console.log("change", "THROWS", error instanceof TypeError ? "TypeError" : error instanceof ReferenceError ? "ReferenceError" : typeof error);
}
try {
  console.log("changed", c());
} catch (error) {
  console.log("changed", "THROWS", error instanceof TypeError ? "TypeError" : error instanceof ReferenceError ? "ReferenceError" : typeof error);
}
console.log("ran", (globalThis.ran ?? []).sort().join(), "seen", globalThis.seen);
