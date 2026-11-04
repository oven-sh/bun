const far = process.argv.length > 40;
const attempt = f => { try { return f(); } catch (e) { return e.name; } };
if (far) { var rm = require.main; }
exports.seen = [typeof rm, typeof rm?.id, typeof rm?.filename, typeof rm?.loaded, attempt(() => rm.id)];
