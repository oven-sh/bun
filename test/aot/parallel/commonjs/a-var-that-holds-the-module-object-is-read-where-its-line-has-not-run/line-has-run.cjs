const far = process.argv.length > 40;
const attempt = f => { try { return f(); } catch (e) { return e.name; } };
var mo = module;
function g() { return typeof mo.id + " " + typeof mo.exports; }
mo.marked = 1;
exports.seen = [typeof mo?.id, typeof mo?.exports, mo.loaded, mo === module, module.marked, g()];
