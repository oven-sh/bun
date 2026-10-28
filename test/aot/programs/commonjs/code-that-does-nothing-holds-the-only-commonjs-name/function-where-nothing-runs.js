if (typeof require === "undefined") { function never() {} class Never {} let a = 1; }
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared30 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("function-where-nothing-runs", typeOfThis(), storeToUndeclaredName());
