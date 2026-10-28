console.log(typeof import.meta.url);
if (typeof Bun === "undefined") {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared47 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("require-call beside import.meta", typeOfThis(), storeToUndeclaredName());
