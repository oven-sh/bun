if (false) {
  console.log(require("node:path").sep);
}
function typeOfThis110(this: unknown) {
  return typeof this;
}
console.log("type-module/false require-call ts", typeOfThis110());
