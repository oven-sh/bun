"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    Square: null,
    UNIT: null,
    area: null,
    default: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    Square: function() {
        return Square;
    },
    UNIT: function() {
        return UNIT;
    },
    area: function() {
        return area;
    },
    default: function() {
        return _default;
    }
});
const UNIT = "cm";
class Square {
    constructor(side){
        this.side = side;
    }
}
function area(shape) {
    return shape.side * shape.side;
}
const _default = Square;
