import "node:path";
if ({ b: 0 }.b) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared151 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("import-beside-the-member", typeOfThis(), storeToUndeclaredName());
