function run(n: number): string { let a = 0; let b = 1; for (let i = 0; i < (n | 0); i++) { const next = (a + b) | 0; a = b; b = next; } return a + ',' + b; }
const lengths = [1048568, 1048575, 1048576, 1048577, 1048583, 1048584, 1048585, 1048591, 1048592, 2097151, 2097152, 2097153, 2097160, 2097167, 3145728, 3145735, 3200001];
function once(length: number): void {  console.log(length, run(length)); }
for (let k = 0; k < lengths.length; k++) once(lengths[k]);
