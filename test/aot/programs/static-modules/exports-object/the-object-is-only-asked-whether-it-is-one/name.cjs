exports.a = 1;
exports.log = [!exports, exports == null, exports === undefined, exports != null, exports ? "object" : "nothing", typeof (exports && 5)].join();
if (exports) exports.b = 2;
exports && (exports.c = 3);
