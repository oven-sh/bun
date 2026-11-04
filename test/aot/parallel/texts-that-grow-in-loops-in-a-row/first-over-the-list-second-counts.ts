// first over the list second counts
const lists: unknown[] = [[1, 2, 3, 4], [0.5, 1.5], [], [7], ["a", "b"], [1, , 3], [null, undefined, true]];
function shape(list: number[]): string { let text = ""; for (let i = 0; i < list.length; i++) text += list[i] + ","; for (let i = 0; i < 2; i++) text += i + ";"; return text; }
const keep: unknown = shape;
(globalThis as any).kept = keep;
for (const list of lists) console.log(JSON.stringify(shape(list as any)));
console.log(typeof keep);
