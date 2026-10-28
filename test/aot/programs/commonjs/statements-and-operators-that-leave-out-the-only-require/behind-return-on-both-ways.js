function f(a) {
  if (a) return 1;
  else return 2;
  require("node:path");
}
f();
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared76 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("behind-return-on-both-ways", typeOfThis(), storeToUndeclaredName());
