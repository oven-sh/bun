if (typeof Bun === "undefined") {
  console.log(typeof require);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared40 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("typeof-require", typeOfThis(), storeToUndeclaredName());
