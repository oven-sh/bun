// STATISTIC: StoresOfCopiedRunsThatTakeListsAsTheyAre >= 1
"use strict";
const show = list => list.length + ":" + Array.from({ length: list.length }, (_, i) => i in list ? (Object.is(list[i], -0) ? "-0" : typeof list[i] === "object" && list[i] !== null ? JSON.stringify(list[i]) : typeof list[i] + ":" + String(list[i])) : "<hole>").join(",");
const plainly = (rows, take) => { const out = []; out.length = rows.length; for (let i = 0; i < rows.length; i++) if (i in rows) out[i] = take(rows[i], i); return out; };
let wrong = 0;
const hold = (got, rows, take, label) => { const want = show(plainly(rows, take)), said = show(got); if (said !== want) { wrong++; console.log("WRONG", label, said, "FOR", want); } return said; };
const brief = text => { let h = 7; for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 1000003; return text.length + "#" + h; };
const births = +process.argv[2] || 8;
const rows0 = []; for (let i = 0; i < 7; i++) rows0.push(JSON.parse('{"w":' + i + ',"v":' + (i) + "}"));
function pick0() { return rows0.map(row => row.v); }
{ const said = []; for (let birth = 0; birth < births; birth++) { said.push(hold(pick0(), rows0, row => row.v, 'dropped:' + birth)); Bun.gc(true); } console.log('SAID dropped', 0, new Set(said).size, said[births - 1]); }
const rows1 = []; for (let i = 0; i < 7; i++) rows1.push(JSON.parse('{"w":' + i + ',"v":' + (i + 0.5) + "}"));
function pick1() { return rows1.map(row => row.v); }
{ const said = []; for (let birth = 0; birth < births; birth++) { said.push(hold(pick1(), rows1, row => row.v, 'dropped:' + birth)); Bun.gc(true); } console.log('SAID dropped', 1, new Set(said).size, said[births - 1]); }
const rows2 = []; for (let i = 0; i < 7; i++) rows2.push(JSON.parse('{"w":' + i + ',"v":' + ('"t' + i + '"') + "}"));
function pick2() { return rows2.map(row => row.v); }
{ const said = []; for (let birth = 0; birth < births; birth++) { said.push(hold(pick2(), rows2, row => row.v, 'dropped:' + birth)); Bun.gc(true); } console.log('SAID dropped', 2, new Set(said).size, said[births - 1]); }

console.log("SAID wrong", wrong);
if (wrong) process.exit(3);
