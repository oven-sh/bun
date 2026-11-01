function called() {}
if ([1, 0][(called(), 0) + 1]) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared111 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("index-that-is-a-sum-with-a-call-and-a-comma", typeOfThis(), storeToUndeclaredName());
