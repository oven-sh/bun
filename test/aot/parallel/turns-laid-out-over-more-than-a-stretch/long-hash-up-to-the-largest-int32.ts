function run(from: number, n: number): number { let h = 7; for (let i = from | 0; i < (n | 0); i++) h = (h * 31 + i) | 0; return h; }
const lengths = [1048568, 1048575, 1048576, 1048577, 1048583, 1048584, 1048585, 1048591, 1048592, 2097151, 2097152, 2097153, 2097160, 2097167, 3145728, 3145735, 3200001];
function once(length: number): void {  console.log(length, run(2147483647 - length, 2147483647), run(2147483640 - length, 2147483641)); }
for (let k = 0; k < lengths.length; k++) once(lengths[k]);
