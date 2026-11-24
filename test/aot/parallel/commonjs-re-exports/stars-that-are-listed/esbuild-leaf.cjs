"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Esbuild = void 0;
class Esbuild {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }
    add(other) {
        return new Esbuild(this.x + other.x, this.y + other.y);
    }
}
exports.Esbuild = Esbuild;
exports.default = "Esbuild";
