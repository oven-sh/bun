'use strict';
var out = [];
function list(x) { return Array.prototype.slice.call(x).map(String).join(",") + "/" + x.length; }
function wrap(fn) { return function (a, b) { if (arguments.length === 0) return "none"; return a === "skip" ? b : fn.apply(this, arguments); }; }
function keep(fn) { return function () { var result = fn.apply(this, arguments); return result === "keep" ? arguments : result; }; }
function change(fn) { return function (a) { var before = a; a = "changed"; if (before === "rare") return list(arguments); return fn.apply(this, arguments) + a; }; }
function late(fn) { return function (a, b, c) { var sum = 0; for (var i = 0; i < arguments.length; i++) sum += arguments[i] === 3 ? 1 : 0; if (sum) return arguments; return fn.apply(null, arguments); }; }
function twice(fn) { return function () { return list(fn.apply(this, arguments)) + (arguments.length > 3 ? list(arguments) : ""); }; }
function thrown(fn) { return function () { try { return fn.apply(this, arguments); } catch (error) { return list(arguments) + error.message; } }; }
function writes(fn) { return function (a) { if (a === 1) { arguments[0] = 9; return list(arguments) + a; } return fn.apply(this, arguments); }; }
function same(fn) { return function () { var first = arguments, second = arguments; if (fn.length > 5) return first === second; first.mark = 1; return fn.apply(this, second) + "|" + arguments.mark; }; }
var plain = function (a, b, c) { return [this === undefined ? "u" : typeof this, a, b, c, arguments.length].map(String).join(); };
var own = function () { return "never"; }; own.apply = function (self, given) { return "own " + list(given) + (given.length ? given === arguments[1] : ""); };
var proxied = new Proxy(plain, { get: function (target, key) { return key === "apply" ? function (self, given) { return "get " + list(given); } : target[key]; } });
var all = [plain, own, proxied, function () { return "keep"; }, function () { throw new Error("no"); }, Function.prototype.bind.call(plain, 5, 6), function (a, b, c, d, e, f) { return a; }, class { static apply(self, given) { return "static " + list(given); } }];
var makers = [wrap, keep, change, late, twice, thrown, writes, same];
var calls = [[], [1], ["skip", 2], ["rare"], [3, 4, 5], [1, 2, 3, 4, 5], [undefined], [{ toString: function () { return "o"; } }, null]];
function say(x) { return typeof x === "object" && x !== null && "length" in x ? Object.prototype.toString.call(x) + list(x) : String(x); }
for (var turn = 0; turn < 6; turn++) {
  var row = [];
  for (var m = 0; m < makers.length; m++) for (var f = 0; f < all.length; f++) {
    var made = makers[m](all[f]);
    for (var c = 0; c < calls.length; c++) { try { row.push(say(c & 1 ? made.apply({}, calls[c]) : made(...calls[c]))); } catch (error) { row.push(error.constructor.name); } }
  }
  out.push(row.join(" ; "));
  if (turn === 3) all[0].apply = function (self, given) { return "laid " + list(given); };
  if (turn === 4) delete all[0].apply;
}
var hash = 0, text = out.join("\n");
for (var i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) % 1000000007;
console.log(hash, text.length, out[0] === out[1], out[0] === out[4], out[0] === out[5]);
console.log(out[0].slice(0, 1500));
console.log(out[4].slice(0, 600));
