"use strict";
// `status` of a Response is a custom accessor of a host object: no site can hold an answer for it. The loop is entered at every turn: its site is asked to be filled ONCE, not at every miss,
// and the other sites of the program are sampled and filled as ever.
// COUNT: operation:operationAOTFillSiteAnswers <= 600
const turns = Number(process.env.SIZE ?? 4000);
const held = { rows: null };
held[process.argv.length > 99 ? "other" : "rows"] = [new Response(null, { status: 201 })];
const record = JSON.parse("{" + Array.from({ length: 18 }, (_, i) => '"n' + i + '":' + i).join() + "}");
function total(rows) { let sum = 0; for (const row of rows) sum += row.status * 2; return sum; }
function weigh(o) { return o.n0 + o.n1 + o.n2 + o.n3 + o.n4 + o.n5 + o.n6 + o.n7 + o.n8 + o.n9 + o.n10 + o.n11 + o.n12 + o.n13 + o.n14 + o.n15 + o.n16 + o.n17; }
let sum = 0;
for (let turn = 0; turn < turns; turn++) sum = (sum + total(held.rows) + weigh(record)) % 1000003;
console.log(sum);
