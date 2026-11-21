"use strict";
const show = list => list.length + ":" + Array.from({ length: list.length }, (_, i) => i in list ? (Object.is(list[i], -0) ? "-0" : typeof list[i] === "object" && list[i] !== null ? JSON.stringify(list[i]) : typeof list[i] + ":" + String(list[i])) : "<hole>").join(",");
const plainly = (rows, take) => { const out = []; out.length = rows.length; for (let i = 0; i < rows.length; i++) if (i in rows) out[i] = take(rows[i], i); return out; };
let wrong = 0;
const hold = (got, rows, take, label) => { const want = show(plainly(rows, take)), said = show(got); if (said !== want) { wrong++; console.log("WRONG", label, said, "FOR", want); } return said; };
const brief = text => { let h = 7; for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 1000003; return text.length + "#" + h; };

const whole = []; for (let i = 0; i < 11; i++) whole.push(JSON.parse('{"w":' + i + ',"v":' + (i) + "}"));
const fractions = []; for (let i = 0; i < 11; i++) fractions.push(JSON.parse('{"w":' + i + ',"v":' + (i + 0.5) + "}"));
const wholeAgain = []; for (let i = 0; i < 11; i++) wholeAgain.push(JSON.parse('{"w":' + i + ',"v":' + (i * 2) + "}"));
const texts = []; for (let i = 0; i < 11; i++) texts.push(JSON.parse('{"w":' + i + ',"v":' + ('"t' + i + '"') + "}"));
const fractionsAgain = []; for (let i = 0; i < 11; i++) fractionsAgain.push(JSON.parse('{"w":' + i + ',"v":' + (i + 0.25) + "}"));
const textAtTheEnd = []; for (let i = 0; i < 11; i++) textAtTheEnd.push(JSON.parse('{"w":' + i + ',"v":' + (i === 10 ? '"end"' : i) + "}"));
const notANumber = []; for (let i = 0; i < 11; i++) notANumber.push(JSON.parse('{"w":' + i + ',"v":' + (i + 0.5) + "}")); notANumber[5].v = NaN;
const objects = []; for (let i = 0; i < 11; i++) objects.push(JSON.parse('{"w":' + i + ',"v":' + ('{"k":' + i + '}') + "}"));
const wholeAtLast = []; for (let i = 0; i < 11; i++) wholeAtLast.push(JSON.parse('{"w":' + i + ',"v":' + (i) + "}"));
const nothing = []; for (let i = 0; i < 11; i++) nothing.push(JSON.parse('{"w":' + i + ',"v":' + (i) + "}")); for (const row of nothing) row.v = undefined;
const none = [];
function column(rows) { return rows.map(row => row.v); }
const seen = new Map();
for (let t = 0; t < 1650; t++) { const rows = t < 150 ? whole : t < 300 ? fractions : t < 450 ? wholeAgain : t < 600 ? texts : t < 750 ? fractionsAgain : t < 900 ? textAtTheEnd : t < 1050 ? notANumber : t < 1200 ? objects : t < 1350 ? wholeAtLast : t < 1500 ? nothing : none; const label = (t / 150) | 0; const said = hold(column(rows), rows, row => row.v, label + ':' + t); if (!seen.has(label)) seen.set(label, new Set()); seen.get(label).add(said); }
for (const [label, said] of seen) console.log(label, said.size, [...said].join(' / '));
console.log(wrong);
