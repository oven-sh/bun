const list = [];
exports.on = function (f) { list.push(f); };
exports.emit = function (what) { return list.map(function (f) { return f(what); }).join(); };
