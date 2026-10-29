if (typeof Bun === "undefined") {
  /* @__PURE__ */ Object(module);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared104 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("pure-call-where-bun-is-missing", typeOfThis(), storeToUndeclaredName());
