// STATISTIC: InlineeArrayStoresLeftGeneric >= 1
"use strict";
const show = list => list.length + ":" + Array.from({ length: list.length }, (_, i) => i in list ? (Object.is(list[i], -0) ? "-0" : typeof list[i] === "object" && list[i] !== null ? JSON.stringify(list[i]) : typeof list[i] + ":" + String(list[i])) : "<hole>").join(",");
const plainly = (rows, take) => { const out = []; out.length = rows.length; for (let i = 0; i < rows.length; i++) if (i in rows) out[i] = take(rows[i], i); return out; };
let wrong = 0;
const hold = (got, rows, take, label) => { const want = show(plainly(rows, take)), said = show(got); if (said !== want) { wrong++; console.log("WRONG", label, said, "FOR", want); } return said; };
const brief = text => { let h = 7; for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 1000003; return text.length + "#" + h; };
const births = +process.argv[2] || 6;
const stop = new RangeError('stop');
const rows0 = []; for (let i = 0; i < 7; i++) rows0.push(JSON.parse('{"w":' + i + ',"v":' + (i) + "}"));
let fails0 = 3;
function pick0() { return rows0.map(row => { if (row.w === fails0) throw stop; return row.v; }); }
{ const said = []; for (let birth = 0; birth < births; birth++) { try { said.push(hold(pick0(), rows0, row => row.v, 'thrown:' + birth)); } catch (error) { said.push(error.constructor.name); fails0 = -1; } } console.log('SAID thrown', 0, said[0], new Set(said).size, said[births - 1]); }
const rows1 = []; for (let i = 0; i < 7; i++) rows1.push(JSON.parse('{"w":' + i + ',"v":' + (i + 0.5) + "}"));
let fails1 = 3;
function pick1() { return rows1.map(row => { if (row.w === fails1) throw stop; return row.v; }); }
{ const said = []; for (let birth = 0; birth < births; birth++) { try { said.push(hold(pick1(), rows1, row => row.v, 'thrown:' + birth)); } catch (error) { said.push(error.constructor.name); fails1 = -1; } } console.log('SAID thrown', 1, said[0], new Set(said).size, said[births - 1]); }
const rows2 = []; for (let i = 0; i < 7; i++) rows2.push(JSON.parse('{"w":' + i + ',"v":' + ('"t' + i + '"') + "}"));
let fails2 = 3;
function pick2() { return rows2.map(row => { if (row.w === fails2) throw stop; return row.v; }); }
{ const said = []; for (let birth = 0; birth < births; birth++) { try { said.push(hold(pick2(), rows2, row => row.v, 'thrown:' + birth)); } catch (error) { said.push(error.constructor.name); fails2 = -1; } } console.log('SAID thrown', 2, said[0], new Set(said).size, said[births - 1]); }

console.log("SAID wrong", wrong);
if (wrong) process.exit(3);
