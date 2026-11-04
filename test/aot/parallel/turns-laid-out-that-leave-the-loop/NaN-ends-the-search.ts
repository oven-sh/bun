function run(list: number[]): number { for (let i = 0; i < list.length; i++) { if (list[i] !== list[i]) return i; } return -1; }

const lengths = [0, 1, 7, 8, 9, 15, 16, 17, 25, 40];
function once(length: number, at: number): void { const list: number[] = []; for (let i = 0; i < length; i++) list.push(i === at ? NaN : i + 0.5); console.log(length, at, run(list)); }
for (let k = 0; k < lengths.length; k++) { for (let at = -1; at <= lengths[k]; at++) once(lengths[k], at); }
