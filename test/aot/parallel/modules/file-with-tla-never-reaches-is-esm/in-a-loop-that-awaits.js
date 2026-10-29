const { sep } = require("node:path");
try {
  throw 0;
  for await (const item of []);
} catch {}
console.log(sep.length, (function () { return this === undefined; })(), typeof module);
