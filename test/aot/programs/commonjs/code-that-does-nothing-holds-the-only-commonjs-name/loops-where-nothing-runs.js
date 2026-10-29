if (typeof require === "undefined") { try { never(); } catch {} for (const a of []) while (a) b: do {} while (a); }
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared31 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("loops-where-nothing-runs", typeOfThis(), storeToUndeclaredName());
