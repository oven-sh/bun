"use strict";
const a = require("./cycle-a");
a.told.push("b runs while a is evaluated");
const keys = {
    kOfB: Symbol("of b"),
};
module.exports = keys;
