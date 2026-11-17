"use strict";
const seen = [];
for (const key of Object.keys(require.cache)) { const entry = require.cache[key]; seen.push(key.split("/").pop(), (entry.children || []).length, typeof entry.parent); }
module.exports = seen.join();
