try {
  if (typeof Bun !== "undefined") throw 1;
  require("node:path");
} catch {}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared61 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("behind-throw", typeOfThis(), storeToUndeclaredName());
