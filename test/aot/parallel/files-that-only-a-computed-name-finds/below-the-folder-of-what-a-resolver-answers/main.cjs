// A file is reached from what a resolver answers: up from it, or below its folder. Where the file lies that the resolver answers with, the build knows: it resolves the call anyway.
// The last two: the main file of a package lies in a folder of its own, which no letter of the name says; and a name that resolves to nothing throws as it did.
const path = require("node:path");
const pick = name => (process.argv.length > 9 ? process.argv[9] : name);
const ways = {
  "up from a file beside": () => require(path.join(require.resolve("./commands/serve.cjs"), "..", pick("build") + ".cjs")),
  "the folder of a file beside": () => require(path.join(path.dirname(require.resolve("./commands/serve.cjs")), pick("build") + ".cjs")),
  "a name without its ending": () => require(path.dirname(require.resolve("./commands/serve")) + "/" + pick("build") + ".cjs"),
  "up from the manifest of a package": () => require(path.join(require.resolve("some-package/package.json"), "..", "lib", pick("build") + ".cjs")),
  "the folder of the manifest of a package": () => require(path.join(path.dirname(require.resolve("some-package/package.json")), "lib", pick("build") + ".cjs")),
  "the folder of the main file of a package": () => require(path.join(path.dirname(require.resolve("other-package")), "parts", pick("build") + ".cjs")),
  "a name that resolves to nothing": () => require(path.join(path.dirname(require.resolve("./commands/none.cjs")), pick("build") + ".cjs")),
};
for (const [way, load] of Object.entries(ways)) {
  try {
    console.log(way + ":", load().said);
  } catch (error) {
    console.log(way + ":", error.code);
  }
}
