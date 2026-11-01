var x = 1,
  y = {};
if (!{ a: String(1) } === true) {
  module.id;
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared364 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("not-an-object-made-with-a-call-compared", typeOfThis(), storeToUndeclaredName());
