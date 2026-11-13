// Names are appended to a literal: the first takes a value and makes room for those behind it, so the undefined laid under them has to be written into that room.
// Under: --aot-check=Validate
'use strict';
function make(id, value) { var row = { id: id }; row.first = value; row.second = undefined; row.third = undefined; row.fourth = undefined; return row; }
function fill(row, value) { row.fourth = value; row.second = value; }
var turns = JSON.parse("4"), given = JSON.parse('[{"n":1},{"n":2}]');
for (var i = 0; i < turns; i++) {
    var row = make(i, i === 2 ? undefined : given[i & 1]);
    console.log(Object.keys(row).join(), JSON.stringify(row), "second" in row, Object.hasOwn(row, "third"), Object.hasOwn(row, "fourth"), row.second, row.fourth);
    if (i & 1) { fill(row, given[0]); console.log(Object.keys(row).join(), JSON.stringify(row), row.third); }
}
