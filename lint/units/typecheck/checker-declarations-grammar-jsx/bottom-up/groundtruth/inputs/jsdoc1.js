/**
 * @param {number} a
 * @param {string} missing
 * @param {string} b.c
 */
function f(a, b) { return a; }
/** @augments {Wrong} */
class K extends Base {}
class Base {}
class Wrong {}
/** @type {?number} */
var n = null;
exports.x = 1;
module.exports.y = f;
function Ctor() { this.p = 1; }
Ctor.prototype.m = function () { this.q = 2; };
var r = require("./other");
