// A constructor function of the old kind, copied into the function that calls it: seven names in the cell, six laid undefined one behind the other, one more behind them.
// Under: --aot-check=Validate
'use strict';
function Sign(flags, name) {
    this.flags = flags; this.name = name; this.list = undefined; this.id = 0; this.parent = undefined;
    this.members = undefined; this.exports = undefined; this.twin = undefined; this.only = undefined; this.used = undefined; this.place = undefined;
    this.links = undefined;
}
function make(flags, name) { var sign = new Sign(flags | 32, name); sign.links = { check: flags }; return sign; }
function fill(sign, value) { sign.exports = value; sign.place = 7; }
var turns = JSON.parse("3");
for (var i = 0; i < turns; i++) {
    var sign = make(i, "n" + i);
    console.log(Object.keys(sign).join(), JSON.stringify(sign), sign.members, "used" in sign);
    if (i === 1) { fill(sign, new Map()); console.log(Object.keys(sign).join(), sign.exports.size, sign.place, sign.twin); }
}
