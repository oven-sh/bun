// The pattern stands in a loop whose bound nobody knows; the row and the last rest are used behind the loop, which may run no turn.
function show(o) { return o === undefined ? "none" : Object.keys(o).map(k => k + "=" + o[k]).join(","); }
function born(i) { return { id: i, name: "n" + i, age: 20 + i }; }
function last(row, n) { let kept; for (let i = 0; i < n; i++) { const { id, ...rest } = row; kept = rest; } return show(kept) + "/" + show(row); }
function grows(row, n) { let kept = row; for (let i = 0; i < n; i++) { const { id, ...rest } = kept; kept = { id: id + 1, ...rest, turn: i }; } return show(kept) + "/" + show(row); }
function nested(row, n) { let kept; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const { name, ...rest } = row; kept = rest; } return show(kept) + "/" + show(row); }
for (const bound of ["0", "1", "2", '""', "null", "-1", '"2"']) { const n = JSON.parse(bound); console.log(bound, last(born(1), n), grows(born(2), n), nested(born(3), n)); }
console.log(last(born(4), undefined));
