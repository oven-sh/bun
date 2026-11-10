"use strict";
// A loop reckons with a name read off rows of several kinds. Ordinary objects out of JSON.parse, four structures; halfway texts and a hole.
const turns = Number(process.argv[2] ?? 24000), hide = value => [value][JSON.parse("0")];
function total(rows) { let sum = 0; for (const row of rows) sum += row.pad * 2; return sum; }
const ask = hide(total), said = [];
const fill = make => { const rows = JSON.parse("[0,0,0,0,0,0,0,0]"); for (let at = 0; at < rows.length; at++) rows[at] = hide(make(at)); return rows; };
const early = [fill(at => JSON.parse('{"kind":1,"pad":' + at + "}")), fill(at => JSON.parse('{"sort":1,"more":2,"pad":' + at + "}")), fill(at => JSON.parse('{"x":1,"y":2,"w":3,"pad":' + at + "}"))], late = fill(at => JSON.parse('{"q":1,"r":2,"s":3,"t":4,"pad":' + at + "}")), every = [...early, late];
let all = 0;
for (const rows of early) for (let call = 0; call < 4000; call++) all += ask(rows);
for (let turn = 0; turn < turns; turn++) {
    if (turn === turns >> 1) { for (const row of late) row.pad = "3"; delete early[1][2].pad; }
    const got = ask(every[turn & 3]); all += got;
    if (turn % 1999 === 0) said.push(turn + ":" + got);
}
console.log(all, said.join(" "));
