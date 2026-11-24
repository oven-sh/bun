const rows = [{ id: 1 }, { id: 2, extra: 5 }, { id: 3 }];
function add(list) { let sum = 0; for (const row of list) sum += (row.extra ?? 100) + (row.extra ? 1 : 0) + row.id; return sum; }
const said = [];
for (let turn = 0; turn < 3000; turn++) { if (turn === 1000) rows[0].extra = 7; if (turn === 2000) delete rows[1].extra; if (turn % 999 === 0) said.push(add(rows)); else add(rows); }
console.log(said.join(" "));
