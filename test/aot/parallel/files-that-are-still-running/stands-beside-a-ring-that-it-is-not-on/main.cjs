"use strict";
const { kMark } = require("./marks.cjs");
const ledger = require("./ledger.cjs");
class Page { constructor(n) { this[kMark] = n; } read() { return this[kMark]; } }
console.log(ledger.first, ledger.second, new Page(5).read(), typeof kMark);
