// The folder of the file at the head of a specifier, as programs spell it: `path.join(__dirname, ..)`, `path.resolve(__dirname, ..)`, and in an ES module
// `import.meta.dir` and `import.meta.dirname`. The build knows the folder under each, so the files are in the executable and are found.
const path = require("node:path");
const { join, resolve } = require("path");
const row = (name, load) => {
  try {
    console.log(name, JSON.stringify(load()));
  } catch (error) {
    console.log(name, "throws", error.code);
  }
};
const names = ["first", "second"];
row("join, all written", () => require(path.join(__dirname, "lib", "first.js")));
row("join, one text", () => require(path.join(__dirname, "lib/second.js")));
row("join by its own name", () => require(join(__dirname, "lib", "first.js")));
row("resolve", () => require(path.resolve(__dirname, "lib", "second.js")));
row("resolve by its own name", () => require(resolve(__dirname, "lib/first.js")));
row("a data file", () => require(path.join(__dirname, "data.json")).name);
row("up from a folder below", () => require("./sub/up.cjs"));
row("join with ./", () => require(path.join(__dirname, "./lib", "./first.js")));
for (const name of names) {
  row("join and a name", () => require(path.join(__dirname, "lib", name + ".js")));
  row("resolve and a name", () => require(path.resolve(__dirname, "lib", `${name}.js`)));
  row("join, the name without its extension", () => require(path.join(__dirname, "lib", name)));
}
row("no such file", () => require(path.join(__dirname, "lib", names[0].slice(0, 0) + "third.js")));
// A folder beside this one whose path is as long as this one's: what follows the first letters alone would spell a file of `lib`.
const beside = ["..", "..", path.basename(__dirname).slice(0, -1) + "_", "lib", "first.js"].join("/");
row("a name that leads out of the folder", () => require(path.join(__dirname, "lib", beside)));
row("a name that leads out and back in", () => require(path.join(__dirname, "lib", ["..", "lib", "second.js"].join("/"))));
import("./module.mjs").then(module => module.rows(names));
