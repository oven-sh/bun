if ("a" + "b" + "é" === "abé") {} else module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared159 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("text-joined-behind-two-with-one-outside-ascii", typeOfThis(), storeToUndeclaredName());
