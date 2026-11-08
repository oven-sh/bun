function make(scale: number): readonly number[] { const made = [0.5 * scale, 1.5 * scale, 2.25 * scale]; return Object.seal(made); }
function total(list: readonly number[]): number { let sum = 0; for (let at = 0; at < list.length; at++) sum += list[at]; return sum; }
function doubled(list: readonly number[]): string { return list.map(x => x * 2).join() + "|" + list.filter(x => x > 1).length + "|" + list.reduce((a, b) => a + b, 0) + "|" + list.some(x => x > 2) + "|" + list.indexOf(list[1]); }
let all = "";
for (let round = 1; round < 5; round++) { const list = make(round); all += total(list) + "," + doubled(list) + ";"; }
console.log(all);
