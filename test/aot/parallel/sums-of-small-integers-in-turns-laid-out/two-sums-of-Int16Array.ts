function say(value: number): string { return Object.is(value, -0) ? '-0' : String(value); }
function run(view: Int16Array, other: Int16Array): string { let t = 0; let u = 5; for (let i = 0; i < view.length; i++) { t += view[i]; u += other[i]; } return say(t) + ' ' + say(u); }
const lengths = [0, 1, 7, 8, 9, 15, 16, 17, 24, 25, 64, 100, 1000];
function once(length: number): void { const view = new Int16Array(length); const other = new Int16Array(length); for (let i = 0; i < length; i++) { view[i] = i * 4099 + 1; other[i] = i; } console.log(length, run(view, other)); }
for (let k = 0; k < lengths.length; k++) once(lengths[k]);
