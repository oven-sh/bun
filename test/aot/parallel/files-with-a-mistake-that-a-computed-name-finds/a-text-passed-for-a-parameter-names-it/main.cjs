const tools = {
  load(name) {
    return require(name);
  },
};
let outcome = "loaded";
try {
  tools.load("./broken.cjs");
} catch (error) {
  outcome = "failed";
}
console.log(outcome);
