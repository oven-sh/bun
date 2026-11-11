var freeGlobal = require("./_freeGlobal");

var freeSelf = typeof self == "object" && self && self.Object === Object && self;

var root = freeGlobal || freeSelf || Function("return this")();

module.exports = root;
