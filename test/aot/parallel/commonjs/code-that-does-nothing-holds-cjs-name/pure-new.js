/* @__PURE__ */ new Object(module);
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared92 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("pure-new", typeOfThis(), storeToUndeclaredName());
