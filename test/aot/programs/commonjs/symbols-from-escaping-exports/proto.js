"use strict";
const { writeSym, streamSym } = require("./symbols");
const prototype = { [writeSym]: write, info(text) { return this[writeSym](text); } };
function write(text) { this[streamSym].push(text); return this[streamSym].length; }
module.exports = function proto() { return Object.create(prototype); };
