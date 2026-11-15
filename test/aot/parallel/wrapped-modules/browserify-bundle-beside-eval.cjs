// A function with a direct eval stands beside the bundle.
(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
var b = require("./b");  console.log(b.g(2), b.late());
},{"./b":2}],2:[function(require,module,exports){
var a = require("./a"); exports.g = function (x) { return a.f(x) + "g"; }; exports.late = function () { return require("./a").f(9); };
},{"./a":3}],3:[function(require,module,exports){
exports.f = function (x) { return "f" + x; };
},{}]},{},[1]);
function evaluate(s) { return eval(s); }
console.log(evaluate("1 + 1"));
