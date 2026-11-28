// The program never names process.cwd.
const path = require("node:path");
const seen = [];
for (let i = 0; i < 3; i++) {
  seen.push(path.basename(path.resolve("x", "..")), path.basename(path.dirname(path.resolve("x"))));
  process.chdir("..");
}
console.log(seen.join());
