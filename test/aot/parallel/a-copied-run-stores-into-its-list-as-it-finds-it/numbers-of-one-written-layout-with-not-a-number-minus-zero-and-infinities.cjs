// STATISTIC: NumberStoresDispatchedByIndexingType >= 1
"use strict";
const show = list => list.length + ":" + Array.from({ length: list.length }, (_, i) => i in list ? (Object.is(list[i], -0) ? "-0" : typeof list[i] === "object" && list[i] !== null ? JSON.stringify(list[i]) : typeof list[i] + ":" + String(list[i])) : "<hole>").join(",");
const plainly = (rows, take) => { const out = []; out.length = rows.length; for (let i = 0; i < rows.length; i++) if (i in rows) out[i] = take(rows[i], i); return out; };
let wrong = 0;
const hold = (got, rows, take, label) => { const want = show(plainly(rows, take)), said = show(got); if (said !== want) { wrong++; console.log("WRONG", label, said, "FOR", want); } return said; };
const brief = text => { let h = 7; for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 1000003; return text.length + "#" + h; };

const rows = []; for (let i = 0; i < 40; i++) rows.push({ v: i + 0.5, w: i });
function column() { return rows.map(row => row.v); }
const round = label => { const seen = new Set(); for (let t = 0; t < 200; t++) seen.add(hold(column(), rows, row => row.v, label + t)); console.log(label, seen.size, [...seen].join(" / ")); };
round("fractions");
rows[3].v = NaN; rows[7].v = -0; rows[11].v = Infinity; rows[12].v = -Infinity; rows[13].v = 5e-324; rows[14].v = 2 ** 53; rows[15].v = 3; rows[16].v = -1; rows[17].v = 2147483648;
round("odd numbers");
for (const row of rows) row.v = NaN;
round("nothing but NaN");
for (const row of rows) row.v = row.w;
round("whole numbers");
rows[39].v = NaN;
round("NaN at the end");
rows[39].v = 39.5; rows[0].v = NaN;
round("NaN at the start");
const last = column(); console.log(last.includes(NaN), last.indexOf(NaN), last.lastIndexOf(39.5), JSON.stringify(last.slice(0, 3)), wrong);
