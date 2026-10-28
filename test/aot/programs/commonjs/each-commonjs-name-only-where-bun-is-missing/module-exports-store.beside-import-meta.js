console.log(typeof import.meta.url);
if (typeof Bun === "undefined") {
  module.exports = { a: 1 };
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared48 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("module-exports-store beside import.meta", typeOfThis(), storeToUndeclaredName());
