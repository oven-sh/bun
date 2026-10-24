class Kind { constructor() { this.size = Kind.version; } }
module.exports = Kind;
module.exports.version = 4;
Kind.helper = function () { return this === Kind; };
module.exports.own = function () { return module.exports.version; };
module.exports.unread = "nobody names it";
