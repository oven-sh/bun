const Module = require("node:module");
const asked = [];
const originalRequire = Module.prototype.require;
Module.prototype.require = function (request) {
  asked.push("require " + request);
  return request === "node:os" ? { EOL: 7 } : originalRequire.call(this, request);
};
const originalResolver = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  asked.push("resolve " + request);
  return originalResolver.call(this, request, ...rest);
};
console.log(typeof process.getBuiltinModule(process.argv.length > 99 ? "node:path" : "node:os").EOL, asked.join());
