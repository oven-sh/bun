// One loop reads SIZE different holders from in front of it under one counter.
// It writes a program: SIZE says how many holders.
// The function is called through a table under a parsed key: nothing is known of what it is handed, and its loop is tried for views as well as for lists. Behind each `i < length` of a view the counter was given a new name
// that said no more than the one before, noted as the checked name of that one: the names stood in a row as long as the holders read so far, and every mention of the counter went along the row.
// Sizes: 200 400 800
// Passes: 1
// Grows: the build, linear
// Room of the peak: 192 MB: each line of twenty bytes is a read that every copy of the loop holds, and the loop is built for lists, for views and for whatever comes: 159 | 215 | 341 MB at 200 | 400 | 800: a line, 0.3 MB a holder.
// Todo on linux arm64: it grows: the peak 159 | 227 | 375 MB, and at most 354 MB at the last: a holder costs 0.36 MB of the peak there.
const size = Number(process.env.SIZE ?? 4);
const names = Array.from({ length: size }, (_, place) => `a${place}`);
const out = [];
out.push('"use strict";', `function run(${names.join(", ")}) {`, "  let s = 0;", "  for (let i = 0; i < a0.length; i++) {");
for (const name of names) out.push(`    s += ${name}[i] * 2;`);
out.push("  }", "  return s;", "}", "const table = { run };");
out.push(`const lists = Array.from({ length: ${size} }, (_, place) => [place + 0.5, place + 1.5, place + 2.5]);`);
out.push(`console.log(table[JSON.parse('"run"')](...lists));`);
console.log(out.join("\n"));
