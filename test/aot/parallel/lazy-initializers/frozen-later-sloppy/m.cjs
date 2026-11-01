const o = { a: { b: { c: { d: { e: 1 } } } } };
o.toString = () => "mine";
exports.read = () => o;
