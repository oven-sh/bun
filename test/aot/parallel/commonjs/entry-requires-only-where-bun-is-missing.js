// The entry point is sloppy: its only `require` is in a branch that is never taken.
if (typeof Bun === "undefined") console.log(require("node:path").sep);
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared116 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("entry point", typeOfThis(), storeToUndeclaredName());
console.log(delete globalThis.Bun);
