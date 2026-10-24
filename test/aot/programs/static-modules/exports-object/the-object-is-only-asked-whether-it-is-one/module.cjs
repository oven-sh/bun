exports.a = 1;
exports.log = [!module.exports, module.exports == null, module.exports === undefined, module.exports != null, module.exports ? "object" : "nothing", typeof (module.exports && 5)].join();
if (module.exports) exports.b = 2;
module.exports && (exports.c = 3);
