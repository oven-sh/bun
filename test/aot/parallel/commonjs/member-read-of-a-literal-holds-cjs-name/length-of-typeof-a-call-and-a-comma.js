function called() {}
if ((typeof (called(), 1)).length === 3) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared112 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("length-of-typeof-a-call-and-a-comma", typeOfThis(), storeToUndeclaredName());
