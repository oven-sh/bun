if (typeof Bun === "undefined") {
  console.log(require.resolve("node:path"));
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared44 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("require-resolve", typeOfThis(), storeToUndeclaredName());
