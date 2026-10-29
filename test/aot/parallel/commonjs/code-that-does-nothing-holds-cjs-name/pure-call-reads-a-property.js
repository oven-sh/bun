/* @__PURE__ */ Object(module.id);
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared94 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("pure-call-reads-a-property", typeOfThis(), storeToUndeclaredName());
