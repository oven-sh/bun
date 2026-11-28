const { mock, vi } = require("bun:test");
console.log(Object.keys(require.cache).map(path => require("path").basename(path)).sort().join());
