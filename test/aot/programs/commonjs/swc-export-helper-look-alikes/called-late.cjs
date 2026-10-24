"use strict";
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
exports.define = function () {
    _export(exports, {
        a: function() {
            return a;
        }
    });
    return "defined";
};
const a = "a";
