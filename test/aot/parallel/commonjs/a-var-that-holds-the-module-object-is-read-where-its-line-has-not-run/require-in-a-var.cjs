const far = process.argv.length > 40;
const attempt = f => { try { return f(); } catch (e) { return e.name; } };
if (far) { var rq = require; }
exports.seen = [typeof rq, typeof rq?.main, typeof rq?.main?.id, typeof rq?.main?.filename, attempt(() => rq.main.id)];
