const b = require("./b.js")
exports.name = "a"
exports.twice = function (n) { return n * 2 }
exports.fromB = b.value + 1
exports.self = this === exports && module.exports === exports
function Counter(start) { this.count = start }
Counter.prototype.bump = function () { this.count++; return this }
Counter.create = function (n) { return new Counter(n) }
exports.Counter = Counter
exports.kinds = [typeof module, typeof exports].join()
