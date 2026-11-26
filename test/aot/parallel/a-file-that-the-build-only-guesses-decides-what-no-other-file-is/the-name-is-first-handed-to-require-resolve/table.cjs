const table = { part: "./part.mjs" };
exports.seen = JSON.stringify(table);
exports.found = require(require.resolve(table.part));
