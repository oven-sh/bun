/* @__PURE__ */ Object(typeof module);
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared93 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("pure-call-of-typeof", typeOfThis(), storeToUndeclaredName());
