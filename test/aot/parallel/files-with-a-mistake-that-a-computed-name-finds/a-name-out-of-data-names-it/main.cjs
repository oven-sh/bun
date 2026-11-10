let outcome = "loaded";
try {
  require(require("./config.json").plugin);
} catch (error) {
  outcome = "failed";
}
console.log(outcome);
