exports.b = 1;
exports.a = 2;
delete exports.b;
exports.b = 3;
exports.x = 1;
delete exports.x;
console.log(exports.x);
exports.x = 2;
console.log(exports.x);
