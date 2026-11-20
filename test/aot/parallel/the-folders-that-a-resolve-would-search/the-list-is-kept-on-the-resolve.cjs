// The function that require.resolve.paths answers with is kept on the resolve once it is read, one for each require.
const { createRequire } = require("node:module");
const made = createRequire(__filename);
console.log(
  "SAID",
  require.resolve.paths === require.resolve.paths,
  made.resolve.paths !== require.resolve.paths,
  Object.keys(made.resolve),
);
console.log("SAID", typeof require.resolve.bind(null).paths, require.resolve.paths.name, require.resolve.paths.length);
