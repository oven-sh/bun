try {
  require("./module.mjs");
  console.log("first: required");
} catch (error) {
  console.log("first: require threw", error.message);
}
