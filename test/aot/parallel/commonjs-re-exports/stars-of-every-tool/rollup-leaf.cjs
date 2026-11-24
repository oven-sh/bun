"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Rollup = void 0;
class Rollup {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }
    add(other) {
        return new Rollup(this.x + other.x, this.y + other.y);
    }
}
exports.Rollup = Rollup;
exports.default = "Rollup";
