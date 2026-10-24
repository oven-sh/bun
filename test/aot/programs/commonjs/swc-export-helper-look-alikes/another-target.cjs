"use strict";
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
const holder = {};
_export(holder, {
    a: function() {
        return a;
    }
});
exports.holder = holder;
const a = "a";
