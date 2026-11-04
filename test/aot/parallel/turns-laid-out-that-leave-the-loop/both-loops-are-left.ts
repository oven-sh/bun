function run(view: Uint8Array, rounds: number): number { let t = 0; outer: for (let r = 0; r < rounds; r++) { for (let i = 0; i < view.length; i++) { if (view[i] === 200 && r === 1) break outer; t += view[i] + r; } } return t; }

const lengths = [0, 1, 7, 8, 9, 15, 16, 17, 25, 40];
function once(length: number, at: number): void { const view = new Uint8Array(length); for (let i = 0; i < length; i++) view[i] = i === at ? 200 : i % 100; console.log(length, at, run(view, 3)); }
for (let k = 0; k < lengths.length; k++) { for (let at = -1; at <= lengths[k]; at++) once(lengths[k], at); }
