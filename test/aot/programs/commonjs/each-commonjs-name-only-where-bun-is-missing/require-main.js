if (typeof Bun === "undefined") {
  console.log(require.main === module);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared45 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("require-main", typeOfThis(), storeToUndeclaredName());
