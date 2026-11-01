if (typeof require === "undefined") { async function never() {} }
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared77 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("async-function-where-nothing-runs", typeOfThis(), storeToUndeclaredName());
