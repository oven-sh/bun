// Bundles whose bodies replace their exports by a function: what stands there before, what is called, and who else reaches it.
console.log("loop1");
(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
const dox = require("./two"); globalThis.B = class { run(n) { const p = []; for (let i = 0; i < n; i++) p[i] = dox(i); return Promise.all(p); } }; new B().run(4).then(v => console.log(v.join()));
},{"./two":2,"./three":3}],2:[function(require,module,exports){
module.exports = async function dox(i) { if (i === 2) await null; return i * 2; };
},{"./one":1}],3:[function(require,module,exports){
module.exports = function () { return 1; };
},{}]},{},[1]);
console.log("loop2");
(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
let dox = require("./two"); let s = 0; for (let i = 0; i < 6; i++) { if (i === 3) dox = require("./three"); s += dox(i); } console.log(s);
},{"./two":2,"./three":3}],2:[function(require,module,exports){
module.exports = function (x) { return x + 1; };
},{"./one":1}],3:[function(require,module,exports){
module.exports = function () { return 1; };
},{}]},{},[1]);
console.log("replace1");
(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
const t = require("./two"); let s = 0; for (let i = 0; i < 9; i++) s += t(i); console.log(s, t.again()(3), require("./two").again === undefined);
},{"./two":2,"./three":3}],2:[function(require,module,exports){
const first = function (x) { return x + 1; }; first.again = function () { module.exports = function (x) { return "second" + x; }; return module.exports; }; module.exports = first;
},{"./one":1}],3:[function(require,module,exports){
module.exports = function () { return 1; };
},{}]},{},[1]);
console.log("replace2");
(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
let s = 0; for (let i = 0; i < 4; i++) { const t = require("./two"); try { s += t(i); } catch (e) { s += e.constructor.name; } if (i === 1) require("./three")(); } console.log(s);
},{"./two":2,"./three":3}],2:[function(require,module,exports){
module.exports = function (x) { return x + 1; }; exports.swap = 1; globalThis.swap = function () { module.exports = { notCallable: true }; };
},{"./one":1}],3:[function(require,module,exports){
module.exports = function () { globalThis.swap(); };
},{}]},{},[1]);
console.log("cyc1");
(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
const t = require("./two"); console.log(t.seen, t.later()); module.exports = function () { return "one"; }; console.log(t.later()());
},{"./two":2,"./three":3}],2:[function(require,module,exports){
const one = require("./one"); exports.seen = typeof one + Object.keys(one).length; exports.later = () => require("./one");
},{"./one":1}],3:[function(require,module,exports){
module.exports = function () { return 1; };
},{}]},{},[1]);
console.log("cyc2");
(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
exports.early = 1; const t = require("./two"); module.exports = class One { m() { return t.kind; } }; let s = ""; for (let i = 0; i < 4; i++) s += new module.exports().m(); console.log(s, t.kind, typeof t.one());
},{"./two":2,"./three":3}],2:[function(require,module,exports){
const first = require("./one"); let kind = typeof first + first.early; exports.kind = kind; exports.one = () => require("./one");
},{"./one":1}],3:[function(require,module,exports){
module.exports = function () { return 1; };
},{}]},{},[1]);
console.log("throw1");
(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
for (let i = 0; i < 3; i++) { try { const t = require("./two"); console.log(typeof t, Object.keys(t).length, typeof t === "function" ? t(1) : "none"); } catch (e) { console.log("threw", e.message); } }
},{"./two":2,"./three":3}],2:[function(require,module,exports){
if (!globalThis.once) { globalThis.once = 1; throw new Error("first"); } module.exports = function (x) { return x; };
},{"./one":1}],3:[function(require,module,exports){
module.exports = function () { return 1; };
},{}]},{},[1]);
console.log("throw2");
(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
for (let i = 0; i < 3; i++) { try { const t = require("./two"); let s = 0; for (let k = 0; k < 5; k++) s += t(k); console.log(s); } catch (e) { console.log(e.constructor.name, e.message); } }
},{"./two":2,"./three":3}],2:[function(require,module,exports){
require("./one"); exports.partial = 1; if (!globalThis.o2) { globalThis.o2 = 1; null.x; } module.exports = function (x) { return x; };
},{"./one":1}],3:[function(require,module,exports){
module.exports = function () { return 1; };
},{}]},{},[1]);
console.log("undef1");
(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
const t = require("./two"); try { for (let i = 0; i < 2; i++) console.log(t(i)); } catch (e) { console.log(e.constructor.name, e.message); }
},{"./two":2,"./three":3}],2:[function(require,module,exports){
module.exports = undefined;
},{"./one":1}],3:[function(require,module,exports){
module.exports = function () { return 1; };
},{}]},{},[1]);
console.log("cache1");
(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
const a = arguments; const t = require("./two"); console.log(t(1)); const n = a[5]; n[2].exports = function (x) { return "replaced" + x; }; console.log(require("./two")(1)); let s = 0; for (let i = 0; i < 5; i++) s += require("./two")(i).length || 0; console.log(s);
},{"./two":2,"./three":3}],2:[function(require,module,exports){
module.exports = function (x) { return x + 1; };
},{"./one":1}],3:[function(require,module,exports){
module.exports = function () { return 1; };
},{}]},{},[1]);
console.log("cache2");
(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
const t = require("./two"); let s = 0; for (let i = 0; i < 9; i++) s += t(i); console.log(s, typeof arguments[4][2][0], Object.keys(arguments[4]).length);
},{"./two":2,"./three":3}],2:[function(require,module,exports){
module.exports = function (x) { return x + 1; };
},{"./one":1}],3:[function(require,module,exports){
module.exports = function () { return 1; };
},{}]},{},[1]);
