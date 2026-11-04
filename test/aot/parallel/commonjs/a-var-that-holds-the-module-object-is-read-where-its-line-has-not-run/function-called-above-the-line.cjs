const far = process.argv.length > 40;
const attempt = f => { try { return f(); } catch (e) { return e.name; } };
const early = f();
var mo = module;
function f() { return typeof mo?.id + " " + typeof mo?.exports; }
exports.seen = [early, f()];
