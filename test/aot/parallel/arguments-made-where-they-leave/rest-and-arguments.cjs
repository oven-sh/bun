'use strict';
var out = [];
function list(x) { return Array.prototype.slice.call(x).map(String).join(",") + "/" + x.length; }
var makers = [
  function (fn) { return function (...rest) { rest[0] = 9; rest.push(7); return fn.name === "keep" ? list(arguments) + list(rest) : fn.apply(this, rest); }; },
  function (fn) { return function (a, ...rest) { rest.length = 0; return rest.length === 1 ? null : fn.apply(this, arguments) + list(rest); }; },
  function (fn) { return function (a, ...rest) { rest.reverse(); if (fn.name === "keep") { return list(arguments) + "|" + list(rest); } return fn.apply(this, arguments); }; },
  function (fn) { return function (...rest) { rest[1] = "w"; return fn.apply(this, arguments); }; },
  function (fn) { return function (a, b, ...rest) { var given = rest; given[0] = "g"; if (a === 3) return list(arguments); return fn.call(this, a, b, ...given); }; },
];
var all = [function plain() { return list(arguments); }, function keep() { return list(arguments); }];
var own = function () { return "never"; }; own.apply = function (self, given) { return "own " + list(given); }; all.push(own);
var calls = [[], [1], [1, 2], [3, 4, 5], [1, 2, 3, 4, 5]];
for (var turn = 0; turn < 3; turn++) for (var m = 0; m < makers.length; m++) for (var f = 0; f < all.length; f++) for (var c = 0; c < calls.length; c++) { var made = makers[m](all[f]); try { out.push(String(c & 1 ? made.apply({}, calls[c]) : made(...calls[c]))); } catch (error) { out.push(error.constructor.name); } }
console.log(out.join(" ; "));
