const holder = { b: 0 };
if (holder.b) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared127 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("property-of-a-constant", typeOfThis(), storeToUndeclaredName());
