const { sep } = require("node:path");
do {
  continue;
  await import("./never-loaded.js");
} while (false);
console.log(sep.length, (function () { return this === undefined; })(), typeof module);
