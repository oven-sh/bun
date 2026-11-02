// Alone: what an executable leaves out goes by all that it holds
const Module = require("node:module");
const name = process.env.NO_SUCH_VARIABLE ?? "node:path";
Module._resolveFilename = function (request) { return request === "asked" ? typeof this.createRequire(__filename)(name).sep : request; };
console.log(require.resolve("asked"));
