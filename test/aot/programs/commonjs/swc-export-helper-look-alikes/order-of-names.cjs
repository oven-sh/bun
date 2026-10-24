"use strict";
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    b: function() {
        return b;
    },
    1: function() {
        return one;
    },
    a: function() {
        return a;
    },
    0: function() {
        return zero;
    }
});
const a = "a", b = "b", one = "one", zero = "zero";
