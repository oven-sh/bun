// The older runtime of browserify, under the names that a minifier left, with ids that are texts; behind it one whose bodies something else reaches.
var out = [];
(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({"/lib/a.js":[function(require,module,exports){
"use strict";
const b = require("./b");
module.exports = class Stack {
  items = [];
  push(x) { this.items.push(b.twice(x)); return this; }
  sum() { let s = 0; for (const x of this.items) s += x; return s; }
};
},{"./b":"/lib/b.js"}],"/lib/b.js":[function(require,module,exports){
exports.twice = x => x * 2;
out.push("b runs once");
},{}],"/main.js":[function(require,module,exports){
const Stack = require("./lib/a"), again = require("./lib/b");
const s = new Stack();
for (let i = 0; i < 500; i++) s.push(i);
out.push(s.sum() + " " + again.twice(21));
},{"./lib/a":"/lib/a.js","./lib/b":"/lib/b.js"}]},{},["/main.js"]);

var kept = (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){throw new Error("Cannot find module '"+i+"'")}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
exports.value = this === exports;
exports.names = arguments.length;
},{}],2:[function(require,module,exports){
exports.one = require(["./", "one"].join(""));
try { require("./absent"); } catch (e) { exports.message = e.message; }
},{"./one":1}]},{},[2]);
out.push(JSON.stringify([kept(1), kept(2)]));
for (const line of out) console.log(line);
