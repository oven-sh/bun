"use strict";

// A list --> a set
function makePredicate(words) {
    var map = Object.create(null);
    words.forEach(function (word) { map[word] = true; });
    return map;
}
function member(name, list) { return list.indexOf(name) >= 0; }
function defaults(args, defs) {
    var ret = {};
    for (var i in defs) if (HOP(defs, i)) ret[i] = args && HOP(args, i) ? args[i] : defs[i];
    return ret;
}
function HOP(obj, prop) {
    return Object.prototype.hasOwnProperty.call(obj, prop);
}
var WORDS = words;
