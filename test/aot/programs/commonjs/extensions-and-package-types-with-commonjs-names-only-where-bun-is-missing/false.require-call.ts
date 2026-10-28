if (false) {
  console.log(require("node:path").sep);
}
function typeOfThis90(this: unknown) {
  return typeof this;
}
console.log("false require-call ts", typeOfThis90());
