exports.nameOf = function (one) { return one.name; };
exports.lengthOf = function (one) { return one.length; };
exports.encodingOf = function (one) { return one.encoding; };
exports.hostOf = function (one) { return one.host; };
exports.wantedOf = function (one) { return one.wanted; };
exports.hasName = function (one) { return one.name ? 1 : 0; };
exports.Listed = class Listed { constructor(count) { this.name = "listed" + count; this.length = count; this.encoding = "kept"; this.host = "here"; this.wanted = count; } };
