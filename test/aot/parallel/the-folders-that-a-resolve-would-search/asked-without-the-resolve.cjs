// require.resolve.paths answers for the file of its require, whatever it is called on.
const path = require("node:path");
const { createRequire } = require("node:module");
const where = list => list.map(folder => path.relative(__dirname, folder).split(path.sep).join("/") || ".");
const asAsked = (list, request) => JSON.stringify(list) === JSON.stringify(require.resolve.paths(request));
const { paths } = require.resolve;
const other = createRequire(path.join(__dirname, "other", "x.js"));
const copied = id => other.resolve(id);
copied.paths = require.resolve.paths;
console.log(
  "SAID",
  asAsked(paths("./x"), "./x"),
  asAsked(paths("pkg"), "pkg"),
  asAsked(["./x"].map(require.resolve.paths)[0], "./x"),
);
console.log(
  "SAID",
  asAsked(copied.paths("./x"), "./x"),
  asAsked(require.resolve.paths.call(other.resolve, "./x"), "./x"),
);
const ofOther = other.resolve.paths;
console.log("SAID", where(ofOther("pkg"))[0], where(ofOther("./x")), where(ofOther.bind(require.resolve)("./x")));
