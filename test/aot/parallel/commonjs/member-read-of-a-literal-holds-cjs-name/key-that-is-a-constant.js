const key = "b";
if ({ b: 0 }[key]) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared102 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("key-that-is-a-constant", typeOfThis(), storeToUndeclaredName());
