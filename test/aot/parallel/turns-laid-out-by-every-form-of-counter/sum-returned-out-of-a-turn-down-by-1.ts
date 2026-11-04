function run(v: Uint8Array): number { let t = 5; for (let i = v.length - 1; i >= 0; i--) { if (v[i] === 200) return t * 1000 + i; t += v[i]; } return -t; }
function once(length: number, at: number): number { const v = new Uint8Array(length); for (let i = 0; i < length; i++) v[i] = i === at ? 200 : i % 100; return run(v); }
for (let length = 0; length < 60; length += length < 34 ? 1 : 7) { let said = ""; for (let at = -1; at <= length; at++) said += once(length, at) + " "; console.log(length, said); }
