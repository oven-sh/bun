// STATISTIC: FieldsOutOfLine = 0
"use strict";
var path = require("node:path");
var WIDE = "_wide", USED = "_used";
let KIND = "kind";
function Shelf(wide) { this[WIDE] = wide; this[USED] = 0; this[KIND] = path.sep.length; }
Shelf.prototype.lay = function (n) { const used = this[USED] + n; this[USED] = used > this[WIDE] ? n : used; return this[USED]; };
Shelf.prototype.tell = function () { return Object.keys(this).join() + " " + this._wide + " " + this._used + " " + this.kind + " " + (WIDE in this) + " " + delete this[KIND] + " " + (KIND in this); };
const shelf = new Shelf(50);
let sum = 0;
for (let i = 0; i < 40; i++) sum += shelf.lay(i & 7);
console.log(sum, shelf.tell());
class Box { constructor(v) { this[USED] = v; this[KIND] = "box"; } get size() { return this[USED]; } }
console.log(new Box(3).size, JSON.stringify(new Box(4)));
