"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Babel = void 0;
class Babel {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }
    add(other) {
        return new Babel(this.x + other.x, this.y + other.y);
    }
}
exports.Babel = Babel;
exports.default = "Babel";
