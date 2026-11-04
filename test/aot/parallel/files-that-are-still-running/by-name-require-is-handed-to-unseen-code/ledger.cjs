"use strict";
const probe = (0, eval)("(load) => load('./probe.cjs')")(require);
exports.first = probe.look();
exports.total = 41;
exports.second = probe.look();
