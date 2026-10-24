module.exports = make;
function make(n) { return n * module.exports.version; }
module.exports.version = 3;
make.helper = function () { return this === make; };
module.exports.own = function () { return module.exports.version; };
module.exports.unread = "nobody names it";
