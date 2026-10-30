{ typeof module; console.log("called"); }
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared49 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("beside-a-call-in-a-block", typeOfThis(), storeToUndeclaredName());
