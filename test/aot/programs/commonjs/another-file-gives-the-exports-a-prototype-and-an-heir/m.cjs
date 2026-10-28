exports.a = 1;
exports.readInherited = () => exports.inherited;
exports.readA = () => exports.a;
exports.readThis = function () { return this.a; };
