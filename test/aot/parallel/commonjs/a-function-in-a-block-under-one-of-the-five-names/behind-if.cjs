exports.a = 1;
if (exports.a) function exports() {}
module.exports.seen = [typeof exports, Object.keys(exports).join()];
