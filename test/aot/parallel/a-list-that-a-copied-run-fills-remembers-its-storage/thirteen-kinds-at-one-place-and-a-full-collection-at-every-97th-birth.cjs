// STATISTIC: InlineeArraysGivenAllocationProfiles >= 1
"use strict";
const show = list => list.length + ":" + Array.from({ length: list.length }, (_, i) => i in list ? (list[i] === undefined ? "<u>" : Object.is(list[i], -0) ? "-0" : typeof list[i] === "object" ? JSON.stringify(list[i]) : typeof list[i] + " " + String(list[i])) : "<hole>").join(",");
const plainly = (rows, take) => { const out = []; out.length = rows.length; for (let i = 0; i < rows.length; i++) out[i] = take(rows[i]); return out; };
const hold = (told, got, rows, take, label) => { const want = told(plainly(rows, take)), said = told(got); if (said !== want) { console.log("SAID WRONG", label, said, "FOR", want); process.exit(1); } return said; };
{
  const pick = rows => rows.map(row => row.v);
  const kinds = [i => i, i => i + 0.5, i => "t" + i, i => i, i => (i & 1 ? undefined : i), i => ({ k: i }), i => i * 2, i => (i === 3 ? NaN : i), i => (i === 2 ? -0 : i), i => 2147483648 + i, i => BigInt(i), i => null, i => i];
  kinds.forEach((kind, place) => { const rows = []; for (let i = 0; i < 5; i++) rows.push(JSON.parse(JSON.stringify({ w: i }))); rows.forEach((row, i) => { row.v = kind(i); }); const seen = new Set(); for (let birth = 0; birth < 1000; birth++) { if (birth % 97 === 0) Bun.gc(true); seen.add(hold(show, pick(rows), rows, row => row.v, place + ":" + birth)); } console.log("SAID", place, seen.size, [...seen].join(" / ")); });
}
