(function (root, factory) { module.exports = factory(); })(this, function () { return { a: 1, f() { return this.a; } }; });
