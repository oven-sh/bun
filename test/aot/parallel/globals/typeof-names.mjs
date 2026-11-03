// Typeof of missing and existing names.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const opaque = value => new CustomEvent("opaque", { detail: value }).detail; // the compiler can't see through a value returned by native code
const decoded = text => Buffer.from(text).toString(); // or a string decoded at run time
const told = [];
function attempt(action) {
  try {
    told.push(String(action()));
  } catch (error) {
    told.push(error instanceof TypeError ? error.name : error.name + ": " + error.message);
  }
}
function kinds() {
  return [typeof window, typeof document, typeof Deno, typeof process, typeof Bun, typeof globalThis, typeof undefined, typeof NaN, typeof Array, typeof fetch, typeof navigator, typeof self, typeof global].join();
}
function isBrowser() { return typeof window !== "undefined" && typeof window.document !== "undefined"; }
function isNode() { return typeof process !== "undefined" && process.versions != null && process.versions.node != null; }
function location() {
  if (typeof window === "undefined") return "no window";
  return window.location.href;
}
attempt(kinds);
attempt(kinds);
attempt(isBrowser);
attempt(isNode);
attempt(location);
console.log(told.join("\n"));
