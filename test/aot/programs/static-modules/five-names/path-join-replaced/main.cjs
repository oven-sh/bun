require("./a.js"), require("./other/a.js"), require("./lib.js"), require("./lib/index.js");
const path = require("node:path");
const { join, resolve } = path;
const intoOther = original => (folder, ...rest) => original(folder, "other", ...rest);
const rows = [];
const row = (name, load) => rows.push(async () => {
  try {
    const loaded = await load();
    console.log(name, loaded.default ?? loaded);
  } catch (error) {
    console.log(name, "throws", error.code ?? error.name);
  } finally {
    path.join = join;
    path.resolve = resolve;
  }
});

row("join untouched", () => require(path.join(__dirname, "a.js")));
row("resolve untouched", () => require(path.resolve(__dirname, "a.js")));
row("join untouched, out of the folder and back", () => require(path.join(__dirname, "..", "path-join-replaced", "a.js")));
row("join untouched, out of the folder of another file", () => require("./other/up.js"));
row("join untouched, a slash at the end", () => require(path.join(__dirname, "lib/")));
row("join untouched, no slash at the end", () => require(path.join(__dirname, "lib")));
row("join untouched, the folder alone and a text", () => require(path.join(__dirname) + "/a.js"));
row("join untouched, through a constant", () => {
  const file = path.join(__dirname, "a.js");
  return require(file);
});
row("join untouched, import", () => import(path.join(__dirname, "a.js")));
row("join untouched, require.resolve", () => require.resolve(path.join(__dirname, "a.js")) === join(__dirname, "a.js"));

row("join replaced", () => {
  path.join = intoOther(join);
  return require(path.join(__dirname, "a.js"));
});
row("resolve replaced", () => {
  path.resolve = intoOther(resolve);
  return require(path.resolve(__dirname, "a.js"));
});
row("join replaced while a constant is made, and put back before the load", () => {
  path.join = intoOther(join);
  const file = path.join(__dirname, "a.js");
  path.join = join;
  return require(file);
});
row("join replaced, import", () => {
  path.join = intoOther(join);
  return import(path.join(__dirname, "a.js"));
});
row("join replaced, require.resolve", () => {
  path.join = intoOther(join);
  return require.resolve(path.join(__dirname, "a.js")) === join(__dirname, "other", "a.js");
});
row("join replaced by a function that gives no text", () => {
  path.join = () => ({ toString: () => join(__dirname, "other", "a.js") });
  return require(path.join(__dirname, "a.js"));
});
row("join replaced by a function that gives the same text", () => {
  path.join = (...parts) => join(...parts);
  return require(path.join(__dirname, "a.js"));
});
row("join replaced, the function taken out before that", () => {
  path.join = intoOther(join);
  return require(join(__dirname, "a.js"));
});
row("join replaced, a text joined by hand", () => {
  path.join = intoOther(join);
  return require(__dirname + "/a.js");
});

(async () => {
  for (const run of rows) await run();
})();
