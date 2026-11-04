// do while loops
const lists: unknown[] = [[1, 2, 3, 4], [0.5, 1.5], [], [7], ["a", "b"], [1, , 3], [null, undefined, true]];
function shape(list: number[]): string { let text = ""; let i = 0; do { text += list[i] + ","; i++; } while (i < list.length); i = 0; do { text += list[i] + ";"; i++; } while (i < list.length); return text; }
const keep: unknown = shape;
(globalThis as any).kept = keep;
for (const list of lists) console.log(JSON.stringify(shape(list as any)));
console.log(typeof keep);
