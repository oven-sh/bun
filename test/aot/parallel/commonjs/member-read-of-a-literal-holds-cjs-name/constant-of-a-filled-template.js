const text = { a: `a${1}` }.a;
if (text === "cd") module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared79 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("constant-of-a-filled-template", typeOfThis(), storeToUndeclaredName());
