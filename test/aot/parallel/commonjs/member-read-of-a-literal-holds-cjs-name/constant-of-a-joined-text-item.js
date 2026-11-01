const text = ["a" + "b"][0];
if (text === "cd") module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared147 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("constant-of-a-joined-text-item", typeOfThis(), storeToUndeclaredName());
