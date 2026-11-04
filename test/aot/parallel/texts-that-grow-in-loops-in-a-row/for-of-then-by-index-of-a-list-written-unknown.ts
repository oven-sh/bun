// for of then by index of a list written unknown
const lists: unknown[] = [[1, 2, 3, 4], [0.5, 1.5], [], [7], ["a", "b"], [1, , 3], [null, undefined, true]];
function shape(list: readonly unknown[]): string { let text = ""; for (const x of list) text += x + ","; for (let i = 0; i < list.length; i++) text += list[i] + ";"; return text; }
const keep: unknown = shape;
(globalThis as any).kept = keep;
for (const list of lists) console.log(JSON.stringify(shape(list as any)));
console.log(typeof keep);
