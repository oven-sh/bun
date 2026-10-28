if (typeof Bun === "undefined") {
  this.x = 1;
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared43 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("this", typeOfThis(), storeToUndeclaredName());
