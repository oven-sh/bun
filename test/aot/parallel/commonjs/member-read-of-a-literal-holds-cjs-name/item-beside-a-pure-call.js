function pure() {}
if ([/* @__PURE__ */ pure(), 0][1]) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared24 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("item-beside-a-pure-call", typeOfThis(), storeToUndeclaredName());
