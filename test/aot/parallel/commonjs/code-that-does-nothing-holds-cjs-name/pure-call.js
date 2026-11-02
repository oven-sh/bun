/* @__PURE__ */ Object(module);
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared91 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("pure-call", typeOfThis(), storeToUndeclaredName());
