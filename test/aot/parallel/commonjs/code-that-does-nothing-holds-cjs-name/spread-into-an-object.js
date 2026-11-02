({ ...typeof module });
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared64 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("spread-into-an-object", typeOfThis(), storeToUndeclaredName());
