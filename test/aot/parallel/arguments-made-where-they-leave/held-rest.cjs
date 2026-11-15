'use strict';
var out = [], hold = null;
function list(x) { return Array.prototype.slice.call(x).map(String).join(",") + "/" + x.length; }
function spoil() { if (hold) { hold[0] = "s"; hold[2] = "m"; hold.push("p"); hold.reverse(); } }
function innerOf(fn) { return function (a) { spoil(); if (a === "rare") return "R" + list(arguments); return fn.apply(this, arguments); }; }
function innerNone(fn) { return function () { spoil(); if (fn.name === "keep") return "K" + list(arguments); return fn.apply(this, arguments); }; }
function innerTwo(fn) { return function (a, b) { var n = arguments.length; spoil(); return n > 3 ? list(arguments) + n : fn.apply(null, arguments) + n; }; }
var ends = [function plain() { return list(arguments); }, function keep() { return list(arguments); }];
var own = function () {}; own.apply = function (self, given) { return "own " + list(given); }; ends.push(own);
var inners = []; for (var end of ends) inners.push(innerOf(end), innerNone(end), innerTwo(end));
var outers = [
  function (...rest) { hold = rest; return this(...rest); },
  function (...rest) { hold = rest; return this.apply(null, rest); },
  function (a, ...rest) { hold = rest; return this(a, ...rest); },
  function (...rest) { hold = rest; return Reflect.apply(this, null, rest); },
  function () { hold = null; return this.apply(null, arguments); },
  function (...rest) { hold = rest; var same = rest; return this.call(null, ...same); },
  function () { var copy = Array.from(arguments); hold = copy; return this.apply(null, copy); },
];
var calls = [[], [1], ["rare", 2], [3, 4, 5], ["rare", 2, 3, 4, 5], [1, 2, 3, 4, 5, 6]];
for (var turn = 0; turn < 3; turn++) for (var outer of outers) for (var inner of inners) for (var call of calls) { try { out.push(outer.apply(inner, call)); } catch (error) { out.push(error.constructor.name); } }
function direct(...rest) { hold = rest; return directInner(...rest); }
function directInner(a) { spoil(); return a === "rare" ? list(arguments) : directEnd.apply(null, arguments); }
function directEnd() { return "d" + list(arguments); }
for (var call of calls) out.push(direct(...call), direct.apply(null, call));
console.log(out.join(" ; "));
