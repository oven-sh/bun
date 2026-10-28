exports.who = function () { return this; };
exports.arrow = () => exports;
exports.n = 0;
exports.count = function () { return ++this.n; };
