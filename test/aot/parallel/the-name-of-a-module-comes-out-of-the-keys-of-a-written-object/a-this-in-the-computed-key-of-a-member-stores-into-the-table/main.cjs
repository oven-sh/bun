if (process.argv.length > 99) {
  require("./first.cjs");
  require("./other.cjs");
}
const stored = { name: "./first.cjs" };
stored.change = function () {
  return { [(this.name = "./other.cjs")]() {} };
};
stored.change();
const written = {
  name: "./first.cjs",
  change() {
    return class {
      [(this.name = "./other.cjs")] = 1;
    };
  },
};
written.change();
console.log("SAID", require(stored.name), require(written.name));
