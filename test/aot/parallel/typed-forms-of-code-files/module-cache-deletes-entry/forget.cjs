const Module = require("node:module");
module.exports = path => {
  delete Module._cache[path];
};
