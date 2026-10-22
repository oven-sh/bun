"use strict";
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    a: function() {
        count++;
        return a;
    },
    reads: function() {
        return reads;
    }
});
var count = 0;
const a = "a";
function reads() { return count; }
