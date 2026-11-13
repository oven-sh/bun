function run(v: Uint8Array): number { let t = 0; for (let i = 0; i < v.length - 3; i += 4) t += v[i] + v[i + 1] * 2 + v[i + 2] * 3 + v[i + 3] * 5; return t; }
function once(length: number): void { const v = new Uint8Array(length); for (let i = 0; i < length; i++) v[i] = i * 37 + 11; console.log(length, run(v)); }
for (let length = 0; length < 80; length++) once(length);
