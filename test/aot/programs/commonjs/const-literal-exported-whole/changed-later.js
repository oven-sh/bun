"use strict";
const holder = require("./changed-later-keys");
const before = holder.kFirst;
holder.added = "added from outside";
module.exports = { before, read() { return require("./changed-later-keys"); } };
