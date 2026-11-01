var x = 1,
  y = {};
String(typeof x ?? module.id);
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared337 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("in-an-argument", typeOfThis(), storeToUndeclaredName());
