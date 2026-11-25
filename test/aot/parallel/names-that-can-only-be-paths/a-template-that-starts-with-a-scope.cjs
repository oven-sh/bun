// No module of the library begins with `@kit/part-`.
// STATISTIC: FunctionsLowered <= 700
const name = process.argv[5] ?? "one";
try {
  require(`@kit/part-${name}/addon.node`);
} catch (error) {
  console.log(error.code);
}
