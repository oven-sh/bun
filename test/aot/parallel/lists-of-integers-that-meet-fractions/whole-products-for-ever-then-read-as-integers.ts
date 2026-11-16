// The factors are 2 and 0.5 in turn, so no fraction is ever stored; other loops and built-in methods take the elements as integers: shifts, positions in a table, indexOf, includes, pop, push, at. What is printed is what plain Bun prints.
// STATISTIC: ArraysConvertedToDoubleStorage >= 1
function scale(list: number[], by: number): void { for (let at = 0; at < list.length; at++) list[at] = list[at] * by; }
function bits(list: number[]): number { let all = 0; for (let at = 0; at < list.length; at++) all ^= list[at] << (at & 7); return all; }
function place(list: number[], table: string[]): string { let text = ""; for (let at = 0; at < list.length; at++) text += table[list[at] & 3]; return text; }
const list: number[] = JSON.parse("[1,2,3,4,5,6,7,8]"), table: string[] = JSON.parse('["a","b","c","d"]');
const told: string[] = [];
for (let round = 0; round < 12; round++) { scale(list, round & 1 ? 0.5 : 2); told.push(round + ": " + bits(list) + " " + place(list, table) + " " + list.indexOf(4) + " " + list.includes(6) + " " + JSON.stringify(list) + " " + list.pop() + " " + list.push(8) + " " + list.at(-2)); }
console.log(told.join("\n"));
