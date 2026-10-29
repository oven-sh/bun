"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    C: null,
    f: null,
    l: null,
    v: null,
    x: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    C: function() {
        return C;
    },
    f: function() {
        return f;
    },
    l: function() {
        return l;
    },
    v: function() {
        return v;
    },
    x: function() {
        return x;
    }
});
console.log(globalThis.hook("first"));
const x = 1;
console.log(globalThis.hook("behind x"));
var v = 2;
let l = 3;
class C {}
function f() { return "f"; }
console.log(globalThis.hook("last"));
