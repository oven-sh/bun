"use strict";
var calls = 0;
var Object = { defineProperty(target, name, descriptor) { calls++; target[name] = "from the shadow"; } };
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    a: function() {
        return a;
    }
});
const a = "a";
exports.calls = calls;
