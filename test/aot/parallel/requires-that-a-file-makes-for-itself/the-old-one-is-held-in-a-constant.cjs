const own = require;
require = require("node:module").createRequire(__filename);
console.log(own === require, typeof require.resolve);
