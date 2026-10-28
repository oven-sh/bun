if (typeof Bun === "undefined") {
  console.log(__filename);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared41 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("filename", typeOfThis(), storeToUndeclaredName());
