try {
  require("./flaky.cjs");
} catch (error) {
  console.log(error.message);
}
exports.flaky = "second run";
