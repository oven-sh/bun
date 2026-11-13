var which = process.argv.length > 99;
exports.before = 1;
if (which) module.exports = exports = { never: 1 };
else { try { exports = module.exports = fail(); } catch (e) { exports.caught = e.message; } }
for (var i = 0; i < 3; i++) if (i === 1) exports = module.exports = { i: i, old: exports };
exports.after = Object.keys(exports.old).join();
function fail() { throw new Error("no"); }
