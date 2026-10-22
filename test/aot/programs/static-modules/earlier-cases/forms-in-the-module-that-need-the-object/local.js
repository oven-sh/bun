var self = exports;
self.a = 1; exports.b = 2;
exports.keys = function () { return Object.keys(self).join(); };
