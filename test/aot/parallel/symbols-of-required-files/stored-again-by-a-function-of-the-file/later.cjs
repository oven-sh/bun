"use strict";
const { kA, kB } = require("./symbols.cjs");
const o = {}; o[kA] = 1; o[kB] = 2;
module.exports = Reflect.ownKeys(o).map(String).join();
