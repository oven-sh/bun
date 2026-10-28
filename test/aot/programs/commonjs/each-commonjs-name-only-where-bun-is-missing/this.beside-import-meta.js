console.log(typeof import.meta.url);
if (typeof Bun === "undefined") {
  this.x = 1;
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared51 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("this beside import.meta", typeOfThis(), storeToUndeclaredName());
