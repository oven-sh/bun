exports.f = () => "first";
({ a: /** @type {any} */ (exports.f) } = { a: () => "second" });
