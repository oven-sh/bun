"use strict";
const show = list => list.length + ":" + Array.from({ length: list.length }, (_, i) => i in list ? (list[i] === undefined ? "<u>" : Object.is(list[i], -0) ? "-0" : typeof list[i] === "object" ? JSON.stringify(list[i]) : typeof list[i] + " " + String(list[i])) : "<hole>").join(",");
{ // undefined among numbers in one layout
  const rows = []; for (let i = 0; i < 12; i++) rows.push({ v: i % 5 === 2 ? undefined : i + 0.5, w: i });
  function column() { return rows.map(row => row.v); }
  for (let t = 0; t < 4; t++) console.log(show(column()));
}
{ // the neighbours from filter flat map
  const rows = []; for (let i = 0; i < 8; i++) rows.push({ v: i % 3 === 1 ? undefined : i + 0.5, w: i });
  for (let t = 0; t < 3; t++) console.log(show(Array.from(rows, row => row.v)), show(rows.filter(row => row.w & 1).map(row => row.v)), show(rows.flatMap(row => [row.v, row.w])), show(rows.map(row => row.v).filter(v => v !== undefined)));
}
