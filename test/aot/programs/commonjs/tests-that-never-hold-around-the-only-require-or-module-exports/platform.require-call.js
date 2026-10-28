if (process.platform === "os/2") {
  console.log(require("node:path").sep);
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared12 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("platform require-call", typeOfThis(), storeToUndeclaredName());
