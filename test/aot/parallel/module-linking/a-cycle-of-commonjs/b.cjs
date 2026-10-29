const a = require("./a.cjs"); exports.sawA = Object.keys(a).join(); exports.later = () => Object.keys(a).join();
