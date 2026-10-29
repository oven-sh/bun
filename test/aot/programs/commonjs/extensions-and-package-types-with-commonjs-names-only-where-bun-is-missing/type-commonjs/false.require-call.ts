if (false) {
  console.log(require("node:path").sep);
}
function typeOfThis114(this: unknown) {
  return typeof this;
}
console.log("type-commonjs/false require-call ts", typeOfThis114());
