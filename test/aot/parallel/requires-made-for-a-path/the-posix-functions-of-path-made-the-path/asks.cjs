const { createRequire } = require("node:module");
const { dirname, join } = require("path").posix;
function report(way, act) {
  let said;
  try {
    said = act();
  } catch (error) {
    said = error.code ?? error.name;
  }
  console.log(way + ":", said);
}
report(
  "taken out of path.posix",
  () => createRequire(join(dirname(__filename), "vendor", "start.cjs"))("./seventh.cjs").said,
);
report(
  "required where it is called",
  () => createRequire(require("node:path/posix").resolve(__dirname, "other", "start.cjs"))("./fourth.cjs").said,
);
function later() {
  return createRequire(folder(__filename) + "/other/")("./fifth.cjs").said;
}
const folder = require("path/posix").dirname;
report("bound behind the function that calls it", later);
