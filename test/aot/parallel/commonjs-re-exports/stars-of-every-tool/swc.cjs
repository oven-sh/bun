"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: Object.getOwnPropertyDescriptor(all, name).get
    });
}
_export(exports, {
    get Own () {
        return Own;
    },
    get own () {
        return own;
    }
});
_export_star(require("./swc-leaf.cjs"), exports);
function _export_star(from, to) {
    Object.keys(from).forEach(function(k) {
        if (k !== "default" && !Object.prototype.hasOwnProperty.call(to, k)) {
            Object.defineProperty(to, k, {
                enumerable: true,
                get: function() {
                    return from[k];
                }
            });
        }
    });
    return from;
}
class Own {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }
    add(other) {
        return new Own(this.x + other.x, this.y + other.y);
    }
}
let own = 1;
own++;
