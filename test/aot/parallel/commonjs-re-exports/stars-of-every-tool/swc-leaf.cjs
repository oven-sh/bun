"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Swc = void 0;
class Swc {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }
    add(other) {
        return new Swc(this.x + other.x, this.y + other.y);
    }
}
exports.Swc = Swc;
exports.default = "Swc";
