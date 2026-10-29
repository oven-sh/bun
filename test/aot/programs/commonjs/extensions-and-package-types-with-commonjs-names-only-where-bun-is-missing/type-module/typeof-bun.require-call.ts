if (typeof Bun === "undefined") {
  console.log(require("node:path").sep);
}
function typeOfThis108(this: unknown) {
  return typeof this;
}
console.log("type-module/typeof-bun require-call ts", typeOfThis108());
