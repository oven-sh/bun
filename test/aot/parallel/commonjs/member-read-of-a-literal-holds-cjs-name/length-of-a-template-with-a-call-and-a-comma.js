function called() {}
if (`${(called(), "ab")}`.length === 3) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared113 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("length-of-a-template-with-a-call-and-a-comma", typeOfThis(), storeToUndeclaredName());
