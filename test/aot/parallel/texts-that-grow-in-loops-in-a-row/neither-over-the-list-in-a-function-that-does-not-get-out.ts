// neither over the list in a function that does not get out
const lists: unknown[] = [[1, 2, 3, 4], [0.5, 1.5], [], [7], ["a", "b"], [1, , 3], [null, undefined, true]];
function shape(list: number[]): string { let text = ""; for (let i = 0; i < 3; i++) text += i + ","; for (let i = 0; i < 2; i++) text += i + ";"; return text + list.length; }
const keep = 1;
for (const list of lists) console.log(JSON.stringify(shape(list as any)));
console.log(typeof keep);
