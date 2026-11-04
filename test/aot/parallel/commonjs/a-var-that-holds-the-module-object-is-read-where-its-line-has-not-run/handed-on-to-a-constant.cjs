const far = process.argv.length > 40;
const attempt = f => { try { return f(); } catch (e) { return e.name; } };
if (far) { var mo = module; }
const held = mo;
exports.seen = [typeof held, typeof held?.exports, typeof held?.id];
