if (typeof Bun === "undefined") {
  console.log(require("node:path").sep);
}
function typeOfThis88(this: unknown) {
  return typeof this;
}
console.log("typeof-bun require-call ts", typeOfThis88());
