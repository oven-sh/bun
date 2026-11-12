"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Marks = void 0;
var Marks;
(function (Marks) {
    Marks[Marks["End"] = -1] = "End";
    Marks[Marks["Tab"] = 9] = "Tab";
})(Marks || (exports.Marks = Marks = {}));
exports.own = function (c) { return c === Marks.End ? "end" : c === Marks.Tab ? "tab" : "other"; };
