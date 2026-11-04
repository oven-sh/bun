function run(list: number[]): number { let t = 0; for (let i = 0; i < list.length; i++) t += list[i]; return t; }
const lengths = [1048568, 1048575, 1048576, 1048577, 1048583, 1048584, 1048585, 1048591, 1048592, 2097151, 2097152, 2097153, 2097160, 2097167, 3145728, 3145735, 3200001];
function once(length: number): void { const list: number[] = []; for (let i = 0; i < length; i++) list.push((i & 1023) + 0.5); console.log(length, run(list)); }
for (let k = 0; k < lengths.length; k++) once(lengths[k]);
