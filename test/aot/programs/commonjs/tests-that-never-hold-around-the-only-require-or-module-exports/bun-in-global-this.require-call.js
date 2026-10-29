if (!("Bun" in globalThis)) {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared11 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("bun-in-global-this require-call", typeOfThis(), storeToUndeclaredName());
