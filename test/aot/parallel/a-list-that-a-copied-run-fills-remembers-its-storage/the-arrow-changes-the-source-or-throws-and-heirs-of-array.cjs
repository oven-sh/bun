"use strict";
const show = list => list.length + ":" + Array.from({ length: list.length }, (_, i) => i in list ? (list[i] === undefined ? "<u>" : Object.is(list[i], -0) ? "-0" : typeof list[i] === "object" ? JSON.stringify(list[i]) : typeof list[i] + " " + String(list[i])) : "<hole>").join(",");
{ // the arrow changes the source
  function column(rows) { return rows.map((row, i) => { if (i === 1) rows.push({ v: "late" }); if (i === 2) rows[3] = { v: "swapped" }; return row.v; }); }
  for (let t = 0; t < 3; t++) { const rows = []; for (let i = 0; i < 5; i++) rows.push({ v: i ? i + 0.5 : undefined }); console.log(show(column(rows)), rows.length); }
}
{ // an heir of array with its own species
  class Rows extends Array { static get [Symbol.species]() { return Array; } } class Kept extends Array {}
  const a = Rows.from([{ v: 1 }, { v: undefined }, { v: "x" }]); const b = Kept.from([{ v: 1.5 }, { v: undefined }]);
  for (let t = 0; t < 3; t++) { const x = a.map(row => row.v), y = b.map(row => row.v); console.log(show(x), x.constructor.name, show(y), y.constructor.name, y instanceof Kept); }
}
{ // the arrow throws in the middle
  const rows = []; for (let i = 0; i < 6; i++) rows.push({ v: i === 1 ? undefined : i + 0.5 });
  function column(stop) { try { return show(rows.map((row, i) => { if (i === stop) throw new Error("at " + i); return row.v; })); } catch (e) { return e.message; } }
  for (let t = 0; t < 3; t++) console.log(column(0), column(3), column(9));
}
