console.log("SAID body of tax");
(function (root, factory) { if (typeof module === "object" && module.exports) module.exports = factory(require("./dep.cjs")); else root.x = factory(); })(this, function (dep) { return { rate: 1, fee: () => dep.name, show: () => "umd" }; });
