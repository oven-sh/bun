if (process.release.name !== "node") {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared7 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("release-name require-call", typeOfThis(), storeToUndeclaredName());
