try {
  require("./kettle.cjs");
} catch (error) {
  console.log("main caught:", error.message);
}
console.log("main got:", require("./pantry.mjs").pantry);
