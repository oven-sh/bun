var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};

exports.withDefaults = function (options) {
    return __assign(__assign({}, { width: 1 }), options);
};
exports.replace = function () {
    __assign = function () {
        return "replaced later";
    };
};
