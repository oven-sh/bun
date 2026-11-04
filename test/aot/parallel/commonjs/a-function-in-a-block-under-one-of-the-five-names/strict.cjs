"use strict";
exports.a = 1;
let inside;
{ function exports() {} inside = typeof exports; }
module.exports.seen = [inside, typeof exports];
