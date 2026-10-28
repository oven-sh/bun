if (1 == "2") {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared22 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("number-equals-text require-call", typeOfThis(), storeToUndeclaredName());
