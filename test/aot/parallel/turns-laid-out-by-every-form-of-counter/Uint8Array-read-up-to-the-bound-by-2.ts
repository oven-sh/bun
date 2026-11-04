function run(v: Uint8Array): number { let t = 0; for (let i = 0; i <= v.length - 1; i += 2) t += v[i]; return t; }
function hash(v: Uint8Array): number { let h = 7; for (let i = 0; i <= v.length - 1; i += 2) h = (h * 31 + v[i]) | 0; return h; }
function once(length: number): void { const v = new Uint8Array(length); for (let i = 0; i < length; i++) v[i] = i * 37 + 11; console.log(length, run(v), hash(v)); }
for (let length = 0; length < 45; length++) once(length);
once(100); once(1001); once(2100003);
