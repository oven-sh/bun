const path = require("node:path");
const { createRequire } = require("node:module");
const pick = name => (process.argv.length > 9 ? process.argv[9] : name);
const other = createRequire(path.join(__dirname, "vendor", "start.cjs"));
const ways = {
  "the own resolver": () => require(path.join(path.dirname(require.resolve("some-package/package.json")), "lib", pick("build") + ".cjs")),
  "a resolver made for another folder": () => require(path.join(path.dirname(other.resolve("some-package/package.json")), "lib", pick("build") + ".cjs")),
};
for (const [way, load] of Object.entries(ways)) {
  try { console.log(way + ":", load().said); } catch (error) { console.log(way + ":", error.code); }
}
