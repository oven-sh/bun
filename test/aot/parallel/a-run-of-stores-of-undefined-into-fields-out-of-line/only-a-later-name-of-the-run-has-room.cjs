// Two functions append the same names to one literal in different orders: in the second, the name that takes a value makes room for the last name alone, so the run finds no room for its first name and room for its second.
// Under: --aot-check=Validate
'use strict';
function base(id) { return { id: id }; }
function one(id, value) { var row = base(id); row.early = undefined; row.held = value; row.late = undefined; return row; }
function two(id, value) { var row = base(id); row.held = value; row.early = undefined; row.late = undefined; return row; }
function fill(row, value) { row.late = value; row.early = value; }
function told(row) { return Object.keys(row).join() + " " + JSON.stringify(row) + " " + ("early" in row) + " " + Object.hasOwn(row, "late") + " " + Object.hasOwn(row, "early") + " " + row.early + " " + row.late + " " + Object.entries(row).length; }
var turns = JSON.parse("4"), given = JSON.parse('[{"n":1},{"n":2}]');
for (var i = 0; i < turns; i++) {
    var first = one(i, given[i & 1]), second = two(i, given[i & 1]);
    console.log(told(first)); console.log(told(second));
    if (i & 1) { fill(second, given[0]); fill(first, given[1]); console.log(told(first)); console.log(told(second)); }
}
