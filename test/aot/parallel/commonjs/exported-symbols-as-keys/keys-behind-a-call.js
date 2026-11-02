"use strict";
function make(text) { return Symbol(text); }
module.exports = {
    kMade: make("made by a call"),
    kPlain: Symbol("plain"),
};
