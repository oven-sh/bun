Object.freeze(Object.prototype);
exports.toString = 0; module.exports.valueOf = 1; exports.own = 2;
console.log(typeof exports.toString, typeof module.exports.valueOf, exports.own);
