if (typeof Bun === "undefined") {
  console.log(__dirname);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared42 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("dirname", typeOfThis(), storeToUndeclaredName());
