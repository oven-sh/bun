"use strict";
class Reader { read(o) { return KEY === undefined ? "early" : o[KEY]; } }
var first = new Reader().read({ a: 1 });
var KEY = "a";
console.log(first, new Reader().read({ a: 1 }));
class Static { static first = STATIC === undefined ? "early" : STATIC; static { this.second = STATIC === undefined ? "early" : STATIC; } }
var STATIC = "s";
console.log(Static.first, Static.second, STATIC);
