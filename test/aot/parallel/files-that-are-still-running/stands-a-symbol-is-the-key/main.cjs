"use strict";
const { kMark } = require("./marks.cjs");
class Page { constructor(n) { this[kMark] = n; } read() { return this[kMark]; } }
let sum = 0;
for (let i = 0; i < 300; i++) sum += new Page(i).read();
console.log(sum, typeof kMark, String(kMark));
