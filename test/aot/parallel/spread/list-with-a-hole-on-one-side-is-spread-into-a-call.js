// a list with a hole on one side and an empty list on the other are spread into a call
function collect(...values) { return values.length + ":" + values.join(); }
function subject(c, x) { return collect(...(c ? [x, , x] : [])); }
function deed(c, x) { return subject(c, x); }
console.log(deed(true, 1), deed(0, 1), deed("x", null), deed(null, 2));
let lengths = 0;
for (let i = 0; i < 300; i++) lengths += subject(i % 3, i).length;
console.log(String(lengths));
console.log(deed(JSON.parse("1"), "late"), deed(JSON.parse("0"), "late"));
