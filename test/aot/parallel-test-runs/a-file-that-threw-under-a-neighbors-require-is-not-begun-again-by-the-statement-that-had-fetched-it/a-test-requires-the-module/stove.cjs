console.log("stove begins");
try {
  require("./kettle.cjs");
} catch (error) {
  console.log("stove caught:", error.message);
}
console.log("stove ends");
