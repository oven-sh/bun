// STATISTIC: FieldsOutOfLine = 0
"use strict";
var path = require("node:path");
var MAX = "_max", LENGTH = "_length";
let KIND = "kind";
function Cache(max) { this[MAX] = max; this[LENGTH] = 0; this[KIND] = path.sep.length; }
Cache.prototype.add = function (n) { if (this[LENGTH] + n > this[MAX]) this[LENGTH] = 0; this[LENGTH] += n; return this[LENGTH]; };
Cache.prototype.tell = function () { return Object.keys(this).join() + " " + this._max + " " + this._length + " " + this.kind + " " + (MAX in this) + " " + delete this[KIND] + " " + (KIND in this); };
const cache = new Cache(50);
let sum = 0;
for (let i = 0; i < 40; i++) sum += cache.add(i & 7);
console.log(sum, cache.tell());
class Box { constructor(v) { this[LENGTH] = v; this[KIND] = "box"; } get size() { return this[LENGTH]; } }
console.log(new Box(3).size, JSON.stringify(new Box(4)));
