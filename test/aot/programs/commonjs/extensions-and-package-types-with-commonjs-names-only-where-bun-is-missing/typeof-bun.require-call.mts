if (typeof Bun === "undefined") {
  console.log(require("node:path").sep);
}
function typeOfThis96(this: unknown) {
  return typeof this;
}
console.log("typeof-bun require-call mts", typeOfThis96());
