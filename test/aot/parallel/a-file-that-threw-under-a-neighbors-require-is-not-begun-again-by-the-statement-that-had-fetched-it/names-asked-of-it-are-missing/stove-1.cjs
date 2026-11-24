console.log("stove 1 begins");
try {
  require("./kettle-1.cjs");
} catch (error) {
  console.log("stove 1 caught:", error.message);
}
