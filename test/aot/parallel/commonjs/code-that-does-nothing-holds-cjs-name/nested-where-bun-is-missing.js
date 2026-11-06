if (typeof Bun === "undefined") { if (typeof Deno === "undefined") { typeof module; } }
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared36 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("nested-where-bun-is-missing", typeOfThis(), storeToUndeclaredName());
