"use strict";
const first = Symbol("sound");
const second = first;
module.exports = { kSound: first, kCopy: second, made };
function made() { return first; }
