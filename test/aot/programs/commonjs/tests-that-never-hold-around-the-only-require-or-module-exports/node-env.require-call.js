if (process.env.NODE_ENV === "never") {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared15 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("node-env require-call", typeOfThis(), storeToUndeclaredName());
