module.exports = { a: 1, b: f() };
function f() { return module.exports.a; }
