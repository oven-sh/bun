"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    fromB: function() {
        return fromB;
    },
    report: function() {
        return report;
    }
});
const _a = require("./a.cjs");
let text = typeof _a.fromA;
try { text += " " + _a.late; } catch (error) { text += " " + error.name + ": " + error.message; }
const report = text;
function fromB() { return "b"; }
