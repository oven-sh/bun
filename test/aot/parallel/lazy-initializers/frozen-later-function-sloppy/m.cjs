function f() {}
f.toString = () => "mine";
f.call = 5;
f.extra = { a: 1 };
const g = () => 1;
g.toString = () => "of the arrow";
g.bind = 5;
g.more = { a: 1 };
exports.read = () => f;
exports.readArrow = () => g;
