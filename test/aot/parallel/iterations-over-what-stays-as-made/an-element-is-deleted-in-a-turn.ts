function total(list: number[]): number { let sum = 0; for (const item of list) sum += item; return sum; }
function firstTwo(list: number[]): string { const [first, second] = list; return first + "," + second; }
function copy(list: number[]): number[] { return [0, ...list]; }
function all(list: number[]): string { return total(list) + " " + firstTwo(list) + " " + copy(list).join(); }
function make(from: number): number[] { const made: number[] = []; for (let i = 0; i < 4; i++) made.push(from + i); return made; }
function deletes(list: number[]): string { let text = ""; for (const item of list) { text += String(item) + ";"; delete list[2]; } return text; }
let out = ""; for (let round = 0; round < 30; round++) out = deletes(make(round)); console.log(out);
