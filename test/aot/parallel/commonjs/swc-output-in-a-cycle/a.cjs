"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    fromA: function() {
        return fromA;
    },
    seen: function() {
        return seen;
    },
    late: function() {
        return late;
    }
});
const _b = require("./b.cjs");
const late = "late";
const seen = _b.report;
function fromA() { return "a+" + (0, _b.fromB)(); }
