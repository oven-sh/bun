console.log("stove begins");
for (let turn = 0; turn < 2; turn++) {
  try {
    require("./kettle.cjs");
  } catch (error) {
    console.log("stove caught:", error.message);
  }
}
console.log("stove ends");
