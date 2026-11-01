console.log("inner begins");
exports.early = 1;
try {
  console.log("inner got", require("./main.mjs").answer);
} catch (error) {
  console.log("inner caught", error.name, error.message);
}
exports.late = 2;
console.log("inner ends");
