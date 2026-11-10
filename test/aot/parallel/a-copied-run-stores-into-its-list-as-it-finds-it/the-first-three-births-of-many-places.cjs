// STATISTIC: StoresOfCopiedRunsThatTakeListsAsTheyAre >= 1
"use strict";
const show = list => list.length + ":" + Array.from({ length: list.length }, (_, i) => i in list ? (Object.is(list[i], -0) ? "-0" : typeof list[i] === "object" && list[i] !== null ? JSON.stringify(list[i]) : typeof list[i] + ":" + String(list[i])) : "<hole>").join(",");
const plainly = (rows, take) => { const out = []; out.length = rows.length; for (let i = 0; i < rows.length; i++) if (i in rows) out[i] = take(rows[i], i); return out; };
let wrong = 0;
const hold = (got, rows, take, label) => { const want = show(plainly(rows, take)), said = show(got); if (said !== want) { wrong++; console.log("WRONG", label, said, "FOR", want); } return said; };
const brief = text => { let h = 7; for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 1000003; return text.length + "#" + h; };
const births = +process.argv[2] || 3;

const rows0 = []; for (let i = 0; i < 9; i++) rows0.push(JSON.parse('{"w":' + i + ',"v":' + (i) + "}"));
function pick0() { return rows0.map(row => row.v); }
for (let birth = 0; birth < births; birth++) console.log(0, birth, hold(pick0(), rows0, row => row.v, '0:' + birth));
const rows1 = []; for (let i = 0; i < 9; i++) rows1.push(JSON.parse('{"w":' + i + ',"v":' + (i + 0.5) + "}"));
function pick1() { return rows1.map(row => row.v); }
for (let birth = 0; birth < births; birth++) console.log(1, birth, hold(pick1(), rows1, row => row.v, '1:' + birth));
const rows2 = []; for (let i = 0; i < 9; i++) rows2.push(JSON.parse('{"w":' + i + ',"v":' + (i === 4 ? 4.5 : i) + "}"));
function pick2() { return rows2.map(row => row.v); }
for (let birth = 0; birth < births; birth++) console.log(2, birth, hold(pick2(), rows2, row => row.v, '2:' + birth));
const rows3 = []; for (let i = 0; i < 9; i++) rows3.push(JSON.parse('{"w":' + i + ',"v":' + (i === 0 ? 0.5 : i) + "}"));
function pick3() { return rows3.map(row => row.v); }
for (let birth = 0; birth < births; birth++) console.log(3, birth, hold(pick3(), rows3, row => row.v, '3:' + birth));
const rows4 = []; for (let i = 0; i < 9; i++) rows4.push(JSON.parse('{"w":' + i + ',"v":' + (i === 8 ? '"text"' : i) + "}"));
function pick4() { return rows4.map(row => row.v); }
for (let birth = 0; birth < births; birth++) console.log(4, birth, hold(pick4(), rows4, row => row.v, '4:' + birth));
const rows5 = []; for (let i = 0; i < 9; i++) rows5.push(JSON.parse('{"w":' + i + ',"v":' + (i === 0 ? '"text"' : i) + "}"));
function pick5() { return rows5.map(row => row.v); }
for (let birth = 0; birth < births; birth++) console.log(5, birth, hold(pick5(), rows5, row => row.v, '5:' + birth));
const rows6 = []; for (let i = 0; i < 9; i++) rows6.push(JSON.parse('{"w":' + i + ',"v":' + (i + 0.5) + "}")); rows6[4].v = undefined;
function pick6() { return rows6.map(row => row.v); }
for (let birth = 0; birth < births; birth++) console.log(6, birth, hold(pick6(), rows6, row => row.v, '6:' + birth));
const rows7 = []; for (let i = 0; i < 9; i++) rows7.push(JSON.parse('{"w":' + i + ',"v":' + (i) + "}")); rows7[0].v = undefined;
function pick7() { return rows7.map(row => row.v); }
for (let birth = 0; birth < births; birth++) console.log(7, birth, hold(pick7(), rows7, row => row.v, '7:' + birth));
const rows8 = []; for (let i = 0; i < 9; i++) rows8.push(JSON.parse('{"w":' + i + ',"v":' + (i) + "}")); rows8[3].v = NaN;
function pick8() { return rows8.map(row => row.v); }
for (let birth = 0; birth < births; birth++) console.log(8, birth, hold(pick8(), rows8, row => row.v, '8:' + birth));
const rows9 = []; for (let i = 0; i < 9; i++) rows9.push(JSON.parse('{"w":' + i + ',"v":' + (i) + "}")); rows9[3].v = -0;
function pick9() { return rows9.map(row => row.v); }
for (let birth = 0; birth < births; birth++) console.log(9, birth, hold(pick9(), rows9, row => row.v, '9:' + birth));
const rows10 = []; for (let i = 0; i < 9; i++) rows10.push(JSON.parse('{"w":' + i + ',"v":' + (i === 5 ? 2147483648 : i) + "}"));
function pick10() { return rows10.map(row => row.v); }
for (let birth = 0; birth < births; birth++) console.log(10, birth, hold(pick10(), rows10, row => row.v, '10:' + birth));
const rows11 = []; for (let i = 0; i < 9; i++) rows11.push(JSON.parse('{"w":' + i + ',"v":' + (i === 5 ? '{"k":5}' : i + 0.25) + "}"));
function pick11() { return rows11.map(row => row.v); }
for (let birth = 0; birth < births; birth++) console.log(11, birth, hold(pick11(), rows11, row => row.v, '11:' + birth));
const rows12 = []; for (let i = 0; i < 9; i++) rows12.push(JSON.parse('{"w":' + i + ',"v":' + (i === 2 ? null : '"x' + i + '"') + "}"));
function pick12() { return rows12.map(row => row.v); }
for (let birth = 0; birth < births; birth++) console.log(12, birth, hold(pick12(), rows12, row => row.v, '12:' + birth));
const rows13 = []; for (let i = 0; i < 9; i++) rows13.push(JSON.parse('{"w":' + i + ',"v":' + (i & 1 ? i : i + 0.5) + "}"));
function pick13() { return rows13.map(row => row.v); }
for (let birth = 0; birth < births; birth++) console.log(13, birth, hold(pick13(), rows13, row => row.v, '13:' + birth));
const rows14 = []; for (let i = 0; i < 9; i++) rows14.push(JSON.parse('{"w":' + i + ',"v":' + (i) + "}")); rows14[8].v = 10n;
function pick14() { return rows14.map(row => row.v); }
for (let birth = 0; birth < births; birth++) console.log(14, birth, hold(pick14(), rows14, row => row.v, '14:' + birth));
console.log(wrong);
