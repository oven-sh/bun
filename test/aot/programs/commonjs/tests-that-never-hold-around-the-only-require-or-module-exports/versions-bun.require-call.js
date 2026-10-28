if (!process.versions.bun) {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared4 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("versions-bun require-call", typeOfThis(), storeToUndeclaredName());
