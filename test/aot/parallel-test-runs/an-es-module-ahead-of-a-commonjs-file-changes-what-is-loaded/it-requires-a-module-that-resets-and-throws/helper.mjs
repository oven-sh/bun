try {
  require("./throws.mjs");
  console.log("returned");
} catch (e) {
  console.log("caught", e.message);
}
