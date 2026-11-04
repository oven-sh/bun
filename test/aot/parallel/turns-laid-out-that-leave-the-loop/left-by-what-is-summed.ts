function run(view: Uint8Array, most: number): number { let t = 0; let i = 0; for (; i < view.length; i++) { if (t > most) break; t = (t + view[i]) | 0; } return t * 100 + i; }

const lengths = [0, 1, 7, 8, 9, 15, 16, 17, 25, 40];
function once(length: number, at: number): void { const view = new Uint8Array(length); for (let i = 0; i < length; i++) view[i] = i === at ? 200 : i % 100; console.log(length, at, run(view, at * 20)); }
for (let k = 0; k < lengths.length; k++) { for (let at = -1; at <= lengths[k]; at++) once(lengths[k], at); }
