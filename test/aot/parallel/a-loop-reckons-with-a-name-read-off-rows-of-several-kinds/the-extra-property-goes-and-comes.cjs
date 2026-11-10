"use strict";
// A loop reckons with a name read off rows of several kinds. Halfway one kind loses the extra property, another gains twelve more.
const turns = Number(process.argv[2] ?? 24000), hide = value => [value][JSON.parse("0")];
function total(rows) { let sum = 0; for (const row of rows) sum += (row.pad ?? 50) * 2; return sum; }
const ask = hide(total), said = [];
const fill = make => { const rows = JSON.parse("[0,0,0,0,0,0,0,0]"); for (let at = 0; at < rows.length; at++) rows[at] = hide(make(at)); return rows; };
const grow = (one, at) => { one[hide("p") + hide("ad")] = at; return one; };
const early = [fill(at => grow({ kind: at }, at)), fill(at => grow({ sort: at, more: 3 }, at + 1)), fill(at => grow({ x: at, y: 2 }, at + 2))], late = fill(at => grow({ x: at, y: 2, z: 3 }, at + 3)), every = [...early, late];
let all = 0;
for (const rows of early) for (let call = 0; call < 4000; call++) all += ask(rows);
for (let turn = 0; turn < turns; turn++) {
    if (turn === turns >> 1) { for (const row of late) delete row.pad; for (const row of early[0]) for (let at = 0; at < 12; at++) row["n" + at] = at; grow(late[2], 9); }
    const got = ask(every[turn & 3]); all += got;
    if (turn % 1999 === 0) said.push(turn + ":" + got);
}
console.log(all, said.join(" "));
