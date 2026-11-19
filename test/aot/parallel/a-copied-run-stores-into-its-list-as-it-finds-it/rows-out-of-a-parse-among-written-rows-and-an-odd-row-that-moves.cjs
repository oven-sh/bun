// STATISTIC: InlineeArrayStoresLeftGeneric >= 1
"use strict";
const show = list => list.length + ":" + Array.from({ length: list.length }, (_, i) => i in list ? (Object.is(list[i], -0) ? "-0" : typeof list[i] === "object" && list[i] !== null ? JSON.stringify(list[i]) : typeof list[i] + ":" + String(list[i])) : "<hole>").join(",");
const plainly = (rows, take) => { const out = []; out.length = rows.length; for (let i = 0; i < rows.length; i++) if (i in rows) out[i] = take(rows[i], i); return out; };
let wrong = 0;
const hold = (got, rows, take, label) => { const want = show(plainly(rows, take)), said = show(got); if (said !== want) { wrong++; console.log("WRONG", label, said, "FOR", want); } return said; };
const brief = text => { let h = 7; for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 1000003; return text.length + "#" + h; };

function column(rows) { return rows.map(row => row.v); }
const make = () => { const rows = []; for (let i = 0; i < 40; i++) rows.push({ v: i + 0.5, w: i }); return rows; };
const odd = ['{"v":"text","w":2}', '{"w":2}', '{"v":null,"w":2}', '{"v":7,"w":2}', '{"v":7.25,"w":2}', '{"w":2,"v":8.5}', '{"v":{"k":1},"w":2}', '{"v":[1,2],"w":2}', '{"v":true,"w":2}'];
{ const rows = make(); const seen = new Set(); for (let t = 0; t < 150; t++) seen.add(hold(column(rows), rows, row => row.v, "first" + t)); console.log("numbers alone", seen.size, brief([...seen].join())); }
for (const text of odd) for (const place of [0, 1, 2, 17, 38, 39]) {
  const rows = make(); rows[place] = JSON.parse(text);
  const seen = new Set(); for (let t = 0; t < 70; t++) seen.add(hold(column(rows), rows, row => row.v, text + place + ":" + t));
  console.log(text, place, seen.size, brief([...seen].join()));
}
{ const rows = make(); const seen = new Set(); for (let t = 0; t < 150; t++) seen.add(hold(column(rows), rows, row => row.v, "again" + t)); console.log("numbers alone again", seen.size, [...seen].join().slice(0, 90)); }
console.log(wrong);
