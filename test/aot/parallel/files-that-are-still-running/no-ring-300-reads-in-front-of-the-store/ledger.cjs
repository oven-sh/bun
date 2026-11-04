"use strict";
function count() { const seen = {}; for (let i = 0; i < 300; i++) { const answer = globalThis.look(); seen[answer] = (seen[answer] || 0) + 1; } return JSON.stringify(seen); }
exports.first = count();
exports.total = 41;
exports.second = count();
