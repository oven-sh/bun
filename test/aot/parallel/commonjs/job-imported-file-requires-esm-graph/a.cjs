console.log("a runs");
queueMicrotask(() => {
  console.log("a job begins");
  console.log("a job got", require("./other.mjs").value);
});
