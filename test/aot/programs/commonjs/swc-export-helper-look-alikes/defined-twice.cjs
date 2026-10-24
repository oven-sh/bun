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
    }
});
_export(exports, {
    a: function() {
        return b;
    }
});
const a = "a", b = "b";
