exports.a = 1;
let inside;
{ function exports() { return 7; } inside = [typeof exports, exports()]; exports.b = 2; }
module.exports.seen = [...inside, typeof exports, Object.keys(exports).join()];
