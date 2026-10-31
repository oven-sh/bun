// Alone: which file is the main module goes by the entry points of the executable
// A plugin of Bun.build is code that the build does not see, and it may store into whatever it gets at. No statement of the program stores into Bun.main,
// so the entry point stays the main module, `require.main === module` stays folded in the other file, and the program is compiled once.
// STATISTIC: EngineRuns = 1
const other = require("./other.cjs");
if (process.argv.length > 5) {
  Bun.build({ entrypoints: [process.argv[5]] }).then(built => console.log(built.success));
  Bun.plugin({
    name: "none",
    setup(build) {
      build.main = "index.js";
      build.config.main = Bun.main;
    },
  });
  console.log(Bun, Object.keys(Bun), { ...Bun }.main);
}
console.log(require.main === module, other.isMain(), require.main.filename === module.filename);
