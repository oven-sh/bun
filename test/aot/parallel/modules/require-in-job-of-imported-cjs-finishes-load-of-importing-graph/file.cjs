console.log("file begins");
require("./back.mjs");
console.log("file has required back");
queueMicrotask(() => {
  console.log("job begins");
  console.log("job has required", require("./last.mjs").name);
  console.log("job ends");
});
console.log("file ends");
