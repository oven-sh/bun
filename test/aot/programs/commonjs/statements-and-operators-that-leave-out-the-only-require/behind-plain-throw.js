try {
  throw 1;
  require("node:path");
} catch {}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared72 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("behind-plain-throw", typeOfThis(), storeToUndeclaredName());
