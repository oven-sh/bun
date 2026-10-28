if (false) {
  console.log(require("node:path").sep);
}
function typeOfThis98(this: unknown) {
  return typeof this;
}
console.log("false require-call mts", typeOfThis98());
