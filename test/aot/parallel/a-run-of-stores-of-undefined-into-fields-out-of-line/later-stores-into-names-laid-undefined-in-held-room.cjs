// Names appended to a literal behind one that made room keep the undefined that is laid under them, and strangers store into them and read them later.
// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: what is proven of the object is asked again at run time
'use strict';
function make(id, value) { var row = { id: id }; row.first = value; row.second = undefined; row.third = undefined; row.fourth = undefined; return row; }
function fill(row, value) { row.fourth = value; row.second = value; row.third = value; }
function read(row) { return (row.second === undefined ? 1 : 2) + (row.fourth === undefined ? 10 : 20); }
var turns = JSON.parse("12"), sums = [], given = JSON.parse('[{"n":1},{"n":2}]'), ring = [];
for (var i = 0; i < 8; i++) ring.push(make(i, given[0]));
for (var i = 0; i < turns; i++) { ring[i & 7] = make(i, given[i & 1]); sums.push(read(ring[(i + 5) & 7])); fill(ring[(i + 3) & 7], given[0]); sums.push(read(ring[(i + 2) & 7])); }
console.log(sums.join(), ring.map(row => Object.keys(row).join("+") + JSON.stringify(row)).join(" "));
