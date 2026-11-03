if (typeof Bun === "undefined") {
  /* @__PURE__ */ new Object(module);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared105 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("pure-new-where-bun-is-missing", typeOfThis(), storeToUndeclaredName());
