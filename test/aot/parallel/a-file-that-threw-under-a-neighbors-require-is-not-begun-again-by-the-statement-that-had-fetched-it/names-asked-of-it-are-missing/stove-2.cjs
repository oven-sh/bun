console.log("stove 2 begins");
try {
  require("./kettle-2.cjs");
} catch (error) {
  console.log("stove 2 caught:", error.message);
}
