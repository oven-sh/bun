if (process.arch === "pdp11") {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared14 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("arch require-call", typeOfThis(), storeToUndeclaredName());
