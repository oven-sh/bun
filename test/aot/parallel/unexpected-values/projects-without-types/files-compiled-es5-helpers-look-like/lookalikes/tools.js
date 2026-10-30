var __assign = function (target) {
    for (var i = arguments.length - 1; i >= 1; i--) for (var key in arguments[i]) target[key] = arguments[i][key];
    return target;
};
var __spreadArray = function (to, from) {
    return from.concat(to);
};
var __importDefault = function (mod) {
    return { default: "always this" };
};
exports.withDefaults = function (options) {
    return __assign(__assign({}, { width: 1, height: 1 }), options);
};
exports.lastWins = function () {
    return __assign({}, { a: "first" }, { a: "second" });
};
exports.joined = function (first, second) {
    return __spreadArray(__spreadArray([], first, true), second, true);
};
exports.defaultOf = function (loaded) {
    return __importDefault(loaded).default;
};
