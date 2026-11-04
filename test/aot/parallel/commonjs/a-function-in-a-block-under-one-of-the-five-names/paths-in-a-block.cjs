const before = typeof __filename + " " + typeof __dirname;
{ function __filename() {} function __dirname() {} }
exports.seen = [before, typeof __filename, typeof __dirname];
