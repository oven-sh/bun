if ({ b: 0 }.b) require("./property.js");
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared55 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("require-behind-the-member", typeOfThis(), storeToUndeclaredName());
