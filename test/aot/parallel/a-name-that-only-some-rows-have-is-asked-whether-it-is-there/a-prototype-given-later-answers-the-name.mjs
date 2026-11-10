const rows = [{ id: 1 }, { id: 2, extra: 5 }];
function add(list) { let sum = 0; for (const row of list) sum += (row.extra ?? 100) + (row.extra ? 1 : 0) + row.id; return sum; }
const said = [];
for (let turn = 0; turn < 3000; turn++) { if (turn === 1500) Object.setPrototypeOf(rows[0], { extra: 40 }); if (turn % 749 === 0) said.push(add(rows)); else add(rows); }
console.log(said.join(" "));
