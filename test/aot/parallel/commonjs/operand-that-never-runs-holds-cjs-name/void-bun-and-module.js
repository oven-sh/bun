var x = 1,
  y = {};
void Bun && module.id;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared303 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("void-bun-and-module", typeOfThis(), storeToUndeclaredName());
