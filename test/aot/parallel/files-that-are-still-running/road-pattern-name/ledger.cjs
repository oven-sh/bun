"use strict";
const probe = require(`./parts/${JSON.parse('"probe"')}.cjs`);
exports.first = probe.look();
exports.total = 41;
exports.second = probe.look();
