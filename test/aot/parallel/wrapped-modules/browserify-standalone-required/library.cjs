(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.lib = f()}})(function(){var define,module,exports;return (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
var two = require('./two');
class Node4 { constructor(kind, pos) { this.pos = pos; this.kind = kind; this.flags = 0; this.parent = undefined; } getStart() { return this.pos; } }
function create(kind, parent) { const n = new Node4(kind, 1); n.parent = parent; return n; }
function depth(n) { let d = 0; while (n) { if (n.kind === 3) d++; d += n.flags + n.getStart(); n = n.parent; } return d; }
function run(m) { let s = 0; for (let i = 0; i < m; i++) { let p; for (let k = 0; k < 8; k++) p = create(k & 3, p); s += depth(p); } return s; }
exports.Node4 = Node4; exports.create = create; exports.run = run;
exports.two = two;
},{"./two":2}],2:[function(require,module,exports){
module.exports = function (x) { return 2 * x; };
},{}]},{},[1])(1)
});
