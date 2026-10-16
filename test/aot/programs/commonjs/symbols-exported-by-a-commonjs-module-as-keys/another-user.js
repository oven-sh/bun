"use strict";
const { kState, kCount: count } = require("./keys.js");
module.exports = {
    kState,
    stateOf(thing) { return thing[kState]; },
    countOf(thing) { return thing[count]; },
    store(thing, value) { thing[kState] = value; },
};
