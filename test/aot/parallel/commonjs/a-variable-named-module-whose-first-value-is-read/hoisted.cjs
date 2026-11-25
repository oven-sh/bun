function read() { return module; }
exports.early = typeof read();
var module = 1;
exports.late = read();
