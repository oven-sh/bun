// The names of the doors come from outside, so nothing is copied in line and the list is out of sight where it is spliced.
// COUNT: operation:operationAOTArraySpliceGeneric <= 0
// COUNT: operation:operationAOTArraySpliceItemGeneric <= 40
const [OUT, INTO] = JSON.parse('["out","into"]');
const doors = { out(list, at) { list.splice(at, 1); }, into(list, at, item) { list.splice(at, 0, item); } };
const go = (door, ...rest) => doors[door](...rest);
const list = [];
for (let n = 0; n < 12; n++) list.push({ n });
Bun.gc(true); Bun.gc(true);
let sum = 0;
for (let turn = 0; turn < 400; turn++) {
  go(INTO, list, turn % 12, { n: 1000 + turn, held: ["kept " + turn] });
  if (turn % 7 === 0) Bun.gc(false);
  if (turn % 61 === 0) Bun.gc(true);
  for (let waste = 0; waste < 200; waste++) sum += [{ waste }, "w" + waste].length;
  for (const item of list) sum += item.n + (item.held ? item.held[0].length : 0);
  go(OUT, list, (turn * 5) % 12);
}
console.log("SAID", sum, list.length, list.map(item => item.n).join());
