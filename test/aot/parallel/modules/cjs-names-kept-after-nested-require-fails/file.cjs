console.log("file.cjs runs");
try {
  require("./back.mjs");
  console.log("back.mjs required");
} catch (error) {
  console.log("back.mjs threw", error.name);
}
exports.v = 4;
console.log("file.cjs ends");
