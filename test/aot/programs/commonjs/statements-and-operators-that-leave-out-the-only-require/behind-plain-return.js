function f() {
  return 1;
  require("node:path");
}
f();
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared71 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("behind-plain-return", typeOfThis(), storeToUndeclaredName());
