const far = process.argv.length > 40;
const attempt = f => { try { return f(); } catch (e) { return e.name; } };
if (far) { var mo = module; }
exports.seen = [attempt(() => mo.id), attempt(() => mo.exports), attempt(() => mo.loaded), attempt(() => { mo.exports = 1; return "stored"; }), attempt(() => { mo.id = 1; return "stored"; })];
