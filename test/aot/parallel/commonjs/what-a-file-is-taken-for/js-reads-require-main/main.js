const main = require.main;
console.log((function () { return typeof this; })(), (() => { try { Object.freeze({ a: 1 }).a = 2; return "stored in silence"; } catch (error) { return error.constructor.name; } })());
