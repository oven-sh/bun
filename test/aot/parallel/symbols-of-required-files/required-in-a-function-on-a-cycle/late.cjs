"use strict";
exports.look = function () { const { kA, kB } = require("./symbols.cjs"); const o = {}; o[kA] = 1; o[kB] = 2; return Reflect.ownKeys(o).map(String).join(); };
