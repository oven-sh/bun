function Base() {}
Base.prototype = 5;
exports.Unused = class extends Base {};
exports.used = 1;
