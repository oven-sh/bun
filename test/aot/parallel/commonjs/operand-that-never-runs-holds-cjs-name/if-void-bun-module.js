var x = 1,
  y = {};
if (void Bun) {
  module.id;
} else {
  y.a = 1;
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared333 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("if-void-bun-module", typeOfThis(), storeToUndeclaredName());
