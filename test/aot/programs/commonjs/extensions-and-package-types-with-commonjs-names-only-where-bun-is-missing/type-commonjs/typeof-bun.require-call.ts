if (typeof Bun === "undefined") {
  console.log(require("node:path").sep);
}
function typeOfThis112(this: unknown) {
  return typeof this;
}
console.log("type-commonjs/typeof-bun require-call ts", typeOfThis112());
