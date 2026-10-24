"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    count: null,
    describe: null,
    unit: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    count: function() {
        return count;
    },
    describe: function() {
        return describe;
    },
    unit: function() {
        return _units.unit;
    }
});
const _shapes = require("./shapes.cjs");
const _units = require("./units.cjs");
let described = 0;
function count() {
    return described;
}
function describe(shape) {
    described++;
    return (0, _shapes.area)(shape) + " " + _shapes.UNIT + "2";
}
