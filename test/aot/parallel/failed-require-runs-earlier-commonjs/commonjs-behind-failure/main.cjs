try {
  require("./app.mjs");
  console.log("loaded");
} catch (error) {
  console.log("caught", error.name);
}
