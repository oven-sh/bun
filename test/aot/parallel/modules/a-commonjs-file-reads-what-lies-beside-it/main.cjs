// `__dirname`, `__filename` and require.resolve() say where a file lay when the program was built, so a program reads a file beside its source that nobody embedded.
// Reference: bun build --compile
// Alone: it prints where it was built
const fs = require("node:fs");
const path = require("node:path");
console.log(__dirname);
console.log(__filename);
console.log(typeof __dirname, typeof __filename);
console.log(require.resolve("./assets/data.txt"));
console.log(require.resolve("./lib/inner.cjs"));
console.log(fs.readFileSync(path.join(__dirname, "assets", "data.txt"), "utf8").trim());
console.log(fs.readFileSync(require.resolve("./assets/data.txt"), "utf8").trim());
console.log(fs.existsSync(__dirname + "/assets/data.txt"), fs.existsSync(__filename), fs.existsSync(__dirname));
console.log(Bun.file(path.join(__dirname, "assets", "data.txt")).size);
console.log(fs.readdirSync(path.join(__dirname, "assets")).join());
function inAFunction() {
  return [__dirname, __filename, (() => __dirname)()].join();
}
console.log(inAFunction());
console.log(
  (() => {
    const __dirname = "a name of the program's own";
    return __dirname;
  })(),
);
console.log(require("./lib/inner.cjs").join("\n"));
