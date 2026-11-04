function say(value: number): string { return Object.is(value, -0) ? '-0' : String(value); }
function run(view: Int32Array): number { let t = 0; for (let i = 0; i < view.length; i++) t += view[i]; return t; }
const lengths = [0, 1, 7, 8, 9, 15, 16, 17, 24, 25, 64, 100, 1000];
function once(length: number): void { const view = new Int32Array(length); for (let i = 0; i < length; i++) view[i] = i & 1 ? 2147483647 : -2147483648 + i; console.log(length, say(run(view))); }
for (let k = 0; k < lengths.length; k++) once(lengths[k]);
