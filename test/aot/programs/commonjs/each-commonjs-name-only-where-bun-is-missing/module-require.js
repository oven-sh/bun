if (typeof Bun === "undefined") {
  console.log(module.require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared46 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("module-require", typeOfThis(), storeToUndeclaredName());
