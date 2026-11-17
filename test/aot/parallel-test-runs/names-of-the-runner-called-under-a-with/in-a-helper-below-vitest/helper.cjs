exports.callHook = function (object) { with (object) { return afterEach(2); } };
exports.callSuite = function (object) { with (object) { return suite(3); } };
exports.callJest = function (object) { with (object) { return jest(4); } };
