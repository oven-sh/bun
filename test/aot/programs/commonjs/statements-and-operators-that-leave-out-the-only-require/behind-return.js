function f() {
  if (typeof Bun !== "undefined") return 1;
  return require("node:path");
}
f();
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared60 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("behind-return", typeOfThis(), storeToUndeclaredName());
