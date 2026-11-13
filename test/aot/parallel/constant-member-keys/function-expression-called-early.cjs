"use strict";
var read = function (o) { return KEY === undefined ? "early" : o[KEY]; }, first = read({ a: 1 }), KEY = "a";
console.log(first, read({ a: 1 }));
