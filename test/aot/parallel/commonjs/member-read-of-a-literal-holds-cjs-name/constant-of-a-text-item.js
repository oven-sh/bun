const text = ["ab"][0];
if (text === "cd") module.exports = 1;
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
console.log("constant-of-a-text-item", typeOfThis(), storeToUndeclaredName());
