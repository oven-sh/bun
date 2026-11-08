// `require("./part-" + name + ".cjs")` finds the files of the program that are called so, and no module of the library whatever the name is: none comes whole.
// STATISTIC: FunctionsLowered <= 700
const name = process.argv[5] ?? "one";
console.log(require("./part-" + name + ".cjs"));
try {
  require("./part-" + name + "-and-more.cjs");
} catch (error) {
  console.log(error.code);
}
