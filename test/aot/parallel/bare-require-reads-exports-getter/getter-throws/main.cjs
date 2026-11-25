try {
  require("./late.cjs");
  console.log("loaded");
} catch (error) {
  console.log("threw", error.message);
}
console.log(require("./late.cjs").reads);
