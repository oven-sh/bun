if (!process.versions.bun) {
  module.exports = { a: 1 };
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared5 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("versions-bun module-exports-store", typeOfThis(), storeToUndeclaredName());
