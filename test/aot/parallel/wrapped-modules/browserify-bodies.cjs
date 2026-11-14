// The bodies of browserify's runtime: cycles, throws, replaced and late exports, lazy loads, and one name that means two modules.
var out = [];
var show = f => { try { var v = f(); return typeof v === "function" ? "function " + v.name : typeof v === "object" && v ? JSON.stringify(v) : String(v); } catch (e) { return e.constructor.name + ": " + e.message; } };
(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
"use strict";
out.push("point sees " + show(() => count) + " " + show(() => Point));
class Point {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; count++; }
  add(o) { return new Point(this.x + o.x, this.y + o.y); }
}
let count = 0;
exports.Point = Point;
exports.make = function make(x) { return new Point(x, x); };
exports.count = () => count;
},{}],2:[function(require,module,exports){
exports.first = 1;
var other = require("./cycle");
exports.second = other.seen;
exports.third = () => other.later();
},{"./cycle":3}],3:[function(require,module,exports){
var early = require("../early.js");
exports.seen = show(() => early.first) + " " + show(() => early.second);
exports.later = () => early.second + "!";
},{"../early.js":2}],4:[function(require,module,exports){
module.exports = function seven(x) { return x * 7; };
module.exports.own = [7];
exports.lost = 1;
},{}],5:[function(require,module,exports){
exports.before = "set";
if (out.length >= 0) throw new Error("thrown");
exports.after = "never";
},{}],6:[function(require,module){
module.exports = JSON.parse('{"a":[1,2],"__proto__":3}');
},{}],7:[function(require,module,exports){
"use strict";
var loads = 0;
exports.load = function (n) { loads++; return n ? require("./helper")(n) : require("./data").a; };
exports.loads = () => loads;
exports.absent = undefined;
},{"./helper":4,"./data":6}],8:[function(require,module,exports){
"use strict";
var lazy = require("./lazy"), helper = require("./helper");
out.push(String(lazy.load(6)), show(() => lazy.load(0)), String(lazy.loads()), String(helper === lazy), show(() => helper.Point));
var sum = new helper.Point();
for (var i = 0; i < 1000; i++) sum = sum.add(helper.make(i));
out.push(sum.x + "," + sum.y + " of " + helper.count(), Object.keys(helper).join());
var early = require("./early");
out.push(early.second, early.third(), show(() => require("./early") === early));
for (var k = 0; k < 2; k++) { try { var t = require("./thrower"); out.push(show(() => t.before), show(() => t.after)); } catch (e) { out.push(e.message); } }
var seven = require("./seven");
out.push(String(seven(3)), show(() => seven.own), show(() => seven.lost));
helper.added = 1;
out.push(show(() => require("./helper").added), show(() => lazy.absent), show(() => lazy.absent()));
module.exports = { done: true };
globalThis.later = () => require("./seven")(8);
},{"./lazy":7,"./helper":1,"./early":2,"./thrower":5,"./seven":4}]},{},[8]);
out.push(String(later()), typeof require, typeof module);
for (const line of out) console.log(line);
