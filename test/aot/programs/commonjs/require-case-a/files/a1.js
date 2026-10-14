exports.f = () => "first";
/** @type {any} */ (exports.f) = () => "second";
exports.own = exports.f();
