"use strict";
const told = [];
exports.told = told;
const b = require("./cycle-b");
told.push("a has " + String(b.kOfB));
