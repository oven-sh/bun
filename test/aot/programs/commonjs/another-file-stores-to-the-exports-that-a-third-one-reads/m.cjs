exports.a = 1;
exports.f = function () { return "f"; };
exports.readA = () => exports.a;
exports.callF = () => exports.f() + "|" + module.exports.f();
