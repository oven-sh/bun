"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Color = void 0;
exports.f = f;
var Color;
(function (Color) {
    Color[Color["Red"] = 0] = "Red";
    Color[Color["Green"] = 1] = "Green";
})(Color || (exports.Color = Color = {}));
function f() {
    return Color.Green;
}
