// Sloppy code: a function expression that is evaluated once, whose `arguments` object gets out, and whose own name an inner function uses.
exports.named = function named(n) { var args = arguments; return function () { return [named.name, args.length]; }; };
exports.itself = function itself(n) { var args = arguments; return function () { return [itself, args.callee]; }; };
exports.deeper = function deeper(n) { var args = arguments; return function () { return function () { return deeper; }; }; };
exports.called = function called(n) { var args = arguments; if (n > 0) return function () { return called(n - 1); }; return args.length + ":" + n; };
exports.arrow = function arrow(n) { var args = arguments; return () => [arrow.length, args[0], n]; };
exports.declared = function declared(n) { var args = arguments; function inner() { return declared.name + args.length; } return inner; };
exports.handed = function handed(n) { keep(arguments); return function () { return handed.name; }; };
function keep(it) { return it; }
exports.mapped = function mapped(n) { var args = arguments; return function () { args[0] = "stored"; return [mapped.name, n]; }; };
exports.holder = { method: function method(n) { var args = arguments; return function () { return [method, args.callee]; }; } };
console.log(String(exports.named(1)()));
var both = exports.itself(1)();
console.log(both[0] === exports.itself, both[1] === exports.itself);
console.log(exports.deeper(1)()() === exports.deeper);
console.log(exports.called(1)(), exports.called(0));
console.log(String(exports.arrow(7)()));
console.log(exports.declared(1, 2)());
console.log(exports.handed(1)());
console.log(String(exports.mapped(1)()));
var held = exports.holder.method(1)();
console.log(held[0] === exports.holder.method, held[1] === exports.holder.method);
