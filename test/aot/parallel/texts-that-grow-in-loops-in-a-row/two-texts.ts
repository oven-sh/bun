// two texts
const lists: unknown[] = [[1, 2, 3, 4], [0.5, 1.5], [], [7], ["a", "b"], [1, , 3], [null, undefined, true]];
function shape(list: number[]): string { let a = ""; for (let i = 0; i < list.length; i++) a += list[i] + ","; let b = ""; for (let i = 0; i < list.length; i++) b += list[i] + ";"; return a + b; }
const keep: unknown = shape;
(globalThis as any).kept = keep;
for (const list of lists) console.log(JSON.stringify(shape(list as any)));
console.log(typeof keep);
