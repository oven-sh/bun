// STATISTIC: InlineeArraysGivenAllocationProfiles >= 1
"use strict";
const show = list => list.length + ":" + Array.from({ length: list.length }, (_, i) => i in list ? (list[i] === undefined ? "<u>" : Object.is(list[i], -0) ? "-0" : typeof list[i] === "object" ? JSON.stringify(list[i]) : typeof list[i] + " " + String(list[i])) : "<hole>").join(",");
{ // one site sees whole numbers fractions texts and whole numbers again
  const pick = rows => rows.map(row => row.v);
  const kinds = [i => i, i => i + 0.5, i => "t" + i, i => i, i => (i & 1 ? undefined : i), i => ({ k: i }), i => i * 2];
  for (const kind of kinds) { const rows = []; for (let i = 0; i < 5; i++) rows.push(JSON.parse(JSON.stringify({ w: i }))); rows.forEach((row, i) => { row.v = kind(i); }); console.log(show(pick(rows))); }
}
{ // two sites one arrow
  const take = row => row.v; const ints = [], mixed = []; for (let i = 0; i < 6; i++) { ints.push(JSON.parse('{"v":' + i + "}")); mixed.push(JSON.parse(i === 3 ? '{"v":"s"}' : '{"v":' + (i + 0.5) + "}")); }
  for (let t = 0; t < 3; t++) console.log(show(ints.map(take)), show(mixed.map(take)), show(ints.map(take)));
}
{ // minus zero not a number and big numbers
  const values = [-0, NaN, 2147483647, 2147483648, -2147483649, 1e300, 0, undefined, null, true];
  const rows = values.map(v => JSON.parse("{}")); rows.forEach((row, i) => { row.v = values[i]; });
  function column() { return rows.map(row => row.v); }
  for (let t = 0; t < 3; t++) console.log(show(column()));
}
