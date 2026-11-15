const it = require("./index.js");
exports.atLoad = it.early + "," + typeof it.value;
