const far = process.argv.length > 40;
const attempt = f => { try { return f(); } catch (e) { return e.name; } };
if (far) { var mo = module; }
exports.seen = [typeof mo?.exports, typeof mo?.id, typeof mo?.filename, typeof mo?.path, typeof mo?.loaded];
