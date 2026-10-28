console.log(typeof import.meta.url);
if (typeof Bun === "undefined") {
  console.log(__filename);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared50 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("filename beside import.meta", typeOfThis(), storeToUndeclaredName());
