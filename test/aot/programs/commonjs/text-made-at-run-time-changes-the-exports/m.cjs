exports.a = 1; exports.b = 2;
exports.f = () => "f";
exports.read = () => [exports.a, exports.f(), exports.b, exports.c].join();
