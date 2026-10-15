"use strict";
function block(said, name, body) { try { body(); } catch (error) { said.push(name + ": THROWS " + error.constructor.name); } }
function storeAt2(target, value) { target[2] = value; }
function readAt(target, index) { return target[index]; }
var table = [storeAt2, readAt];
function all() {
    var said = [];
    block(said, "untyped", function () {
        class Plain { set 2(v) { said.push("Plain's setter " + v); } get 3() { return "Plain's getter"; } 4() { return "Plain's method"; } }
        var o = new Plain(); table[0](o, "p"); said.push("untyped: own 2: " + Object.prototype.hasOwnProperty.call(o, 2) + " | " + o[3] + " | " + typeof o[4]);
    });
    block(said, "untyped, at the top", function () { var o = new AtTheTop(); table[0](o, "q"); said.push("untyped, at the top: own 2: " + Object.prototype.hasOwnProperty.call(o, 2) + " | " + table[1](o, 3) + " | " + typeof table[1](o, 4)); });
    block(said, "untyped, static", function () { said.push("untyped, static: " + typeof StaticAtTheTop[2] + " | " + StaticAtTheTop[3]); StaticAtTheTop[4] = "r"; });
    block(said, "untyped, an array", function () { var o = Object.setPrototypeOf(["a", "b", , "d"], ForArray.prototype); table[0](o, "s"); said.push("untyped, an array given the prototype: own 2: " + Object.prototype.hasOwnProperty.call(o, 2)); });
    block(said, "untyped, defineProperty first", function () {
        var o = new DefinedLater(); Object.defineProperty(DefinedLater.prototype, 2, { get() { return "defined at 2 on a class still unmade"; }, set(v) { said.push("the setter defined later " + v); }, configurable: true });
        o[2] = "t"; said.push("untyped, defineProperty first: own 2: " + Object.prototype.hasOwnProperty.call(o, 2) + " | " + o[2] + " | " + o.named());
    });
    block(said, "untyped, an heir", function () { var o = new Heir(); o[4] = "u"; said.push("untyped, an heir: own 4: " + Object.prototype.hasOwnProperty.call(o, 4) + " | " + o[3] + " | " + o.viaSuper()); });
    return said;
}
class AtTheTop { set 2(v) { lines.push("AtTheTop's setter " + v); } get 3() { return "AtTheTop's getter"; } 4() { return "AtTheTop's method"; } }
class StaticAtTheTop { static 2() { return 2; } static get 3() { return "StaticAtTheTop's getter"; } static set 4(v) { lines.push("StaticAtTheTop's setter " + v); } }
class ForArray { set 2(v) { lines.push("ForArray's setter " + v); } }
class DefinedLater { named() { return "DefinedLater's named"; } }
class Base { 2() { return "Base's 2"; } get 3() { return "Base's 3"; } set 4(v) { lines.push("Base's setter " + v); } }
class Heir extends Base { viaSuper() { return super[2]() + " by super"; } }
var lines = [];
module.exports = { all, lines };
