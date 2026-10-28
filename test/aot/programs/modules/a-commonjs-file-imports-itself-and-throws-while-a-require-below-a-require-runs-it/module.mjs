try {
  require("./file.cjs");
} catch (error) {
  console.log("module: require threw", error.message);
}
console.log("module ends");
