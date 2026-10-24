"use strict";
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    a: function() {
        return a;
    },
    bump: function() {
        return bump;
    }
});
let a = 1;
function bump() { a++; return a; }
