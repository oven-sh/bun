"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.viaB = exports.b2 = exports.copy = exports.self = exports.never = exports.maker = exports.late = exports.direct = void 0;
exports.direct = "direct";
exports.late = function lateValue() { return "late"; };
exports.maker = function maker() { return function inner() { return (0, exports.late)(); }; };
exports.never = function neverRead() { return "never"; };
exports.self = "value of self";
exports.copy = exports.self;
exports.b2 = "value of b2";
exports.viaB = exports.b2;
class Unused { m() { return "method of Unused"; } }
exports.Unused = Unused;
