if (typeof Bun === "undefined") {
  console.log(require("node:path").sep);
}
function typeOfThis92(this: unknown) {
  return typeof this;
}
console.log("typeof-bun require-call cts", typeOfThis92());
