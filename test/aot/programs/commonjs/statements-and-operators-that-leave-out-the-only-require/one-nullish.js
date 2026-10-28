1 ?? require("node:path");
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared65 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("one-nullish", typeOfThis(), storeToUndeclaredName());
