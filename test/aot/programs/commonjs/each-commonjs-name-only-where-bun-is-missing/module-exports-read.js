if (typeof Bun === "undefined") {
  console.log(module.exports);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared38 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("module-exports-read", typeOfThis(), storeToUndeclaredName());
