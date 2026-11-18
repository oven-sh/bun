module.exports = require("one-function");
globalThis.pendingPrint = import("one-function").then(m =>
  console.log(m.default(), module.exports(), typeof require("one-function")),
);
