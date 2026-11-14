// STATISTIC: InlineeArraysGivenAllocationProfiles >= 1
"use strict";
const show = list => list.length + ":" + Array.from({ length: list.length }, (_, i) => i in list ? (list[i] === undefined ? "<u>" : Object.is(list[i], -0) ? "-0" : typeof list[i] === "object" ? JSON.stringify(list[i]) : typeof list[i] + " " + String(list[i])) : "<hole>").join(",");
{ // a source with holes
  const rows = [{ v: 1.5 }, , { v: undefined }, , { v: "x" }, { v: 3 }]; rows.length = 8;
  function column() { return rows.map(row => row.v); }
  for (let t = 0; t < 3; t++) console.log(show(column()));
}
{ // empty one and very long
  const make = n => { const rows = []; for (let i = 0; i < n; i++) rows.push(JSON.parse('{"v":' + (i % 7 === 3 ? '"s"' : i + 0.25) + "}")); return rows; };
  const pick = rows => rows.map(row => row.v);
  for (const n of [0, 1, 2, 3, 4, 70000, 0, 5]) { const got = pick(make(n)); console.log(n, got.length, n > 10 ? [got[0], got[3], got[n - 1], typeof got[69996]].join() : show(got)); }
}
{ // what is made is written to afterwards
  const rows = []; for (let i = 0; i < 6; i++) rows.push({ v: i === 4 ? undefined : i, w: i });
  function column() { const made = rows.map(row => row.v); made[1] = "text"; made.push(7.5); made[9] = 1; return made; }
  for (let t = 0; t < 3; t++) console.log(show(column()));
}
{ // the made list is summed and sorted
  const rows = JSON.parse("[" + Array.from({ length: 9 }, (_, i) => '{"v":' + (9 - i + 0.5) + "}").join() + "]");
  function total() { const made = rows.map(row => row.v); let s = 0; for (const x of made) s += x; for (let i = 0; i < made.length; i++) s += made[i] * 2; return s + ":" + made.slice().sort((a, b) => a - b).join() + ":" + made.indexOf(5.5) + ":" + made.includes(NaN); }
  for (let t = 0; t < 4; t++) console.log(total());
}
