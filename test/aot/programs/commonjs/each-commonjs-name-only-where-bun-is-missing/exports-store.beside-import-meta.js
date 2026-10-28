console.log(typeof import.meta.url);
if (typeof Bun === "undefined") {
  exports.x = 1;
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared49 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("exports-store beside import.meta", typeOfThis(), storeToUndeclaredName());
