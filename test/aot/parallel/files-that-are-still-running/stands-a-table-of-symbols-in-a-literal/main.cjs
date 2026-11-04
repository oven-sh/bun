"use strict";
const { kFirst, kSecond } = require("./marks.cjs");
function Page(n) { this[kFirst] = n; this[kSecond] = n * 2; }
Page.prototype.sum = function () { return this[kFirst] + this[kSecond]; };
let sum = 0;
for (let i = 0; i < 300; i++) sum += new Page(i).sum();
console.log(sum, String(kFirst), String(kSecond));
