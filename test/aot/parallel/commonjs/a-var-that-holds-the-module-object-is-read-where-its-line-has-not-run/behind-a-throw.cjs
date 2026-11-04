const far = process.argv.length > 40;
const attempt = f => { try { return f(); } catch (e) { return e.name; } };
try { if (!far) throw 1; var mo = module; } catch {}
exports.seen = [typeof mo?.id, typeof mo?.exports];
