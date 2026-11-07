typeof module || Object();
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared118 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("call-unless-typeof", typeOfThis(), storeToUndeclaredName());
