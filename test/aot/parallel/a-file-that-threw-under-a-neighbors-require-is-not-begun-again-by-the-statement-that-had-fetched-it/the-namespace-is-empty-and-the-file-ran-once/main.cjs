try {
  console.log("main got:", require("./pantry.mjs").pantry);
} catch (error) {
  console.log("main caught:", error.message);
}
