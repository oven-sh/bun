if (typeof Bun === "undefined") {
  module;
} else {
  Object();
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared108 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("module-where-bun-is-missing-or-else-a-call", typeOfThis(), storeToUndeclaredName());
