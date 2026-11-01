const lists = [0, 1, 2].map(() => [0, 0]);
const holder = { byName: new Map([["m", { rows: lists }]]) };
const copy = structuredClone(holder);
const out = copy.byName.get("m").rows;
out[0][0] = 7;
console.log(`${out.length} ${String(out[0][0])} ${String(out[1] && out[1][0])} ${String(out[2] && out[2][0])} ${out[0] === out[1]} ${String(lists[0][0])}`);
