class A { m() { return 1; } }
const f = function () { return 2; };
const re = /x/g;
exports.read = () => [A, f, re];
