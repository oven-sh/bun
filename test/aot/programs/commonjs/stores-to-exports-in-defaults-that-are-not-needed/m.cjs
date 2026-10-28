let x, y;
[x = (exports.a = 1)] = [5];
({ x = (exports.b = 2) } = { x: 5 });
({ y: y = (exports.c = 3) } = { y: 5 });
var { z = (exports.d = 4) } = { z: 5 };
(function (p = (exports.e = 5)) {})(1);
exports.end = 0;
