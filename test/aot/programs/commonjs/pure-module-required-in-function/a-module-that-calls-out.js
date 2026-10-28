"use strict";
const seen = [];
function peek() { return typeof require("./a-module-that-calls-out").kBusy; }
seen.push(peek());
module.exports = {
    kBusy: Symbol("busy"),
    seen,
};
seen.push(peek());
