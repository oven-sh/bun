const path = require("node:path");
const { join, resolve } = require("node:path");
const row = (name, load) => {
  try {
    console.log(name, load());
  } catch (error) {
    console.log(name, "throws", error.code);
  }
};
row("written, no slash", () => require("./lib"));
row("written, a slash", () => require("./lib/"));
row("join, no slash", () => require(path.join(__dirname, "lib")));
row("join, a slash", () => require(path.join(__dirname, "lib/")));
row("join by its own name, a slash", () => require(join(__dirname, "lib/")));
row("join, a slash and an empty text", () => require(path.join(__dirname, "lib/", "")));
row("join, a slash of its own", () => require(path.join(__dirname, "lib", "./")));
row("join, a dot behind the slash", () => require(path.join(__dirname, "lib/.")));
row("join, down and up to a slash", () => require(path.join(__dirname, "lib/sub", "../")));
row("resolve, a slash", () => require(path.resolve(__dirname, "lib/")));
row("resolve by its own name, a slash", () => require(resolve(__dirname, "lib/")));
row("join, a slash in front", () => require(path.join(__dirname, "/lib/index.js")));
row("join, slashes in front and behind", () => require(path.join(__dirname, "/lib/")));
row("resolve, a slash in front", () => require(path.resolve(__dirname, "/lib/index.js")));
for (const name of ["lib", "lib/"]) row("join and a name: " + name, () => require(path.join(__dirname, name)));
