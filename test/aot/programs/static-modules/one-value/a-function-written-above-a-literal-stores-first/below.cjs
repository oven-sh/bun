const early = [set("early"), read()].join("|");
module.exports = { a: 2, read };
module.exports.c = early;
function set(name) { module.exports.b = name; return module.exports.b; }
function read() { return [module.exports.a, module.exports.b].join(); }
