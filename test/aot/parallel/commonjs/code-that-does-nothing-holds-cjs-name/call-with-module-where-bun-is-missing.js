if (typeof Bun === "undefined") {
  Object(module);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared106 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("call-with-module-where-bun-is-missing", typeOfThis(), storeToUndeclaredName());
