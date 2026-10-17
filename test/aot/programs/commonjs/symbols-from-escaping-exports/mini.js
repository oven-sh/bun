"use strict";
const proto = require("./proto");
const symbols = require("./symbols");
const { streamSym } = symbols;
function mini() { const instance = proto(); instance[streamSym] = []; return instance; }
function readLate(object) { return object[require("./symbols").streamSym]; }
module.exports = mini;
module.exports.readLate = readLate;
module.exports.symbols = symbols;
