// require.resolve.paths answers for the file of its require, whatever it is called on.
const path = require("node:path");
const { createRequire } = require("node:module");
const where = list => list.map(folder => path.relative(__dirname, folder).split(path.sep).join("/") || ".");
const { paths } = require.resolve;
const other = createRequire(path.join(__dirname, "other", "x.js"));
const copied = id => other.resolve(id);
copied.paths = require.resolve.paths;
console.log(
  "SAID",
  where(require.resolve.paths("./x")),
  where(paths("./x")),
  where(["./x"].map(require.resolve.paths)[0]),
);
console.log("SAID", where(copied.paths("./x")), where(require.resolve.paths.call(other.resolve, "./x")));
console.log(
  "SAID",
  where(paths("pkg"))[0],
  where(other.resolve.paths("pkg"))[0],
  where(other.resolve.paths.bind(null)("./x")),
);
