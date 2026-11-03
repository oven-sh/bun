({ a: typeof module, b() { return module; }, get c() { return exports; } });
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared20 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("object", typeOfThis(), storeToUndeclaredName());
