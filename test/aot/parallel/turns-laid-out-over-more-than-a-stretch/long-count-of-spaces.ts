function run(s: string): number { let n = 0; for (let i = 0; i < s.length; i++) { if (s.charCodeAt(i) === 32) n++; } return n; }
const lengths = [1048568, 1048575, 1048576, 1048577, 1048583, 1048584, 1048585, 1048591, 1048592, 2097151, 2097152, 2097153, 2097160, 2097167, 3145728, 3145735, 3200001];
function once(length: number): void { const text = 'ab cde f'.repeat((length >> 3) + 1).slice(0, length); console.log(length, run(text)); }
for (let k = 0; k < lengths.length; k++) once(lengths[k]);
