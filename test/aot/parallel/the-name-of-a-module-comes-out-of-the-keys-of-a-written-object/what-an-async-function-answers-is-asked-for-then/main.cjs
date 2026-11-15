if (process.argv.length > 99) {
  require("./first.cjs");
  require("./other.cjs");
}
const table = {
  name: "./first.cjs",
  then(done) {
    this.name = "./other.cjs";
    done();
  },
};
[0].forEach(async () => table);
setTimeout(() => console.log("SAID", require(table.name)), 5);
