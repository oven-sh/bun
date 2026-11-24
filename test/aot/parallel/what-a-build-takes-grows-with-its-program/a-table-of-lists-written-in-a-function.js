// A function hands out a table of SIZE short lists, and another one of SIZE records that hold a list each. Each list is a record of data of its own and the table is born by code around them:
// SIZE operations where one stood. What the build takes for them grows as the table does.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Sizes: 2000 8000 32000
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const upTo = write => Array.from({ length: size }, (_, at) => write(at)).join(",");
const out = [];
for (let copy = 0; copy < copies; copy++) {
  out.push(`function lists${copy}() { return [${upTo(at => `[${at},${at + copy}]`)}]; }`);
  out.push(`function records${copy}() { return [${upTo(at => `{k:"k${at}",v:["a${at}","b${copy}"]}`)}]; }`);
}
out.push("let sum = 0;");
for (let copy = 0; copy < copies; copy++) out.push(`for (let turn = 0; turn < 2; turn++) { const made = lists${copy}(), held = records${copy}(); made[0][0] = 7; held[0].v.push("c"); sum += made.length + made[${"0"}][0] + held[0].v.length + held[held.length - 1].v[0].length; }`);
out.push("console.log(sum);");
console.log(out.join("\n"));
