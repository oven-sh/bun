const far = process.argv.length > 40;
const attempt = f => { try { return f(); } catch (e) { return e.name; } };
if (far) { var mo = module; }
exports.seen = [typeof mo?.parent, typeof mo?.children, typeof mo?.paths, typeof mo?.require];
