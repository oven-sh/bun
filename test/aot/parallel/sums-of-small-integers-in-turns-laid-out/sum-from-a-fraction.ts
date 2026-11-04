function say(value: number): string { return Object.is(value, -0) ? '-0' : String(value); }
function run(view: Uint8Array, start: number): number { let t = start; for (let i = 0; i < view.length; i++) t += view[i]; return t; }
const lengths = [0, 1, 7, 8, 9, 15, 16, 17, 24, 25, 64, 100, 1000];
function once(length: number): void { const view = new Uint8Array(length); for (let i = 0; i < length; i++) view[i] = i * 7 + 1; console.log(length, say(run(view, 0.1)), say(run(view, 4503599627370495.5)), say(run(view, 1e-300))); }
for (let k = 0; k < lengths.length; k++) once(lengths[k]);
