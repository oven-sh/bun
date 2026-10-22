var utils = exports;
utils.a = "a";
utils = { a: "other" };
exports.seen = utils.a;
