const big = [1n][0];
if (big === 2n) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared148 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("constant-of-a-bigint-item", typeOfThis(), storeToUndeclaredName());
