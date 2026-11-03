// Alone: what an executable leaves out goes by all that it holds
const Module = require("node:module");
module.exports = { count: 1 };
Module._resolveFilename = function (request, parent) { parent.exports = { count: "replaced" }; return request; };
console.log(require.resolve("asked"), module.exports.count);
