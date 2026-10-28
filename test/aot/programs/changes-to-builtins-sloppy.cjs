exports.assign = function (object, key, value) { object[key] = value; return "done"; };
exports.remove = function (object, key) { return delete object[key]; };
