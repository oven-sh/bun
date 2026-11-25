console.log("stove 3 begins");
try {
  require("./kettle-3.cjs");
} catch (error) {
  console.log("stove 3 caught:", error.message);
}
