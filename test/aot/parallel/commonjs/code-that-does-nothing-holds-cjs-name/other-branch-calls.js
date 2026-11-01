if (typeof Bun === "undefined") { typeof module; } else { console.log("called"); }
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared51 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("other-branch-calls", typeOfThis(), storeToUndeclaredName());
