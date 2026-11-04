exports.a = 1;
{ function exports() {} }
module.exports.seen = [typeof exports, exports === module.exports];
