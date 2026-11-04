const far = process.argv.length > 40;
const attempt = f => { try { return f(); } catch (e) { return e.name; } };
var mo = module;
mo.id = "stored";
mo.loaded = "also";
exports.seen = [module.id, module.loaded, mo.id];
