"use strict";
const probe = require("./probe.mjs");
exports.get = function () { return new Page().n; };
exports.first = probe.look();
class Page { constructor() { this.n = 41; } }
exports.second = probe.look();
