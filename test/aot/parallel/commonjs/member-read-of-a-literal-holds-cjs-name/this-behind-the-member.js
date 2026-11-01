if ("ab"[0] === "b") this.a = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared58 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("this-behind-the-member", typeOfThis(), storeToUndeclaredName());
