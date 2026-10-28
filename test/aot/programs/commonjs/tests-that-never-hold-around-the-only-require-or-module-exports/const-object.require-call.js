const always = {};
if (!always) {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared20 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("const-object require-call", typeOfThis(), storeToUndeclaredName());
