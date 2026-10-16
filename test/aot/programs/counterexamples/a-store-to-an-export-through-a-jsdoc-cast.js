// A store to `exports.f` through a JSDoc cast is a store: the call runs the second function.
exports.f = () => "first";
/** @type {any} */ (exports.f) = () => "second";
console.log(exports.f());
