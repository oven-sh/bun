import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const pick = name => (process.argv.length > 9 ? process.argv[9] : name);
const ways = {
  "require.resolve": () => require(path.join(path.dirname(require.resolve("some-package/package.json")), "lib", pick("build") + ".cjs")),
  "import.meta.resolve": () => require(path.join(path.dirname(fileURLToPath(import.meta.resolve("other-package/package.json"))), "lib", pick("build") + ".cjs")),
};
for (const [way, load] of Object.entries(ways)) {
  try { console.log(way + ":", load().said); } catch (error) { console.log(way + ":", error.code); }
}
