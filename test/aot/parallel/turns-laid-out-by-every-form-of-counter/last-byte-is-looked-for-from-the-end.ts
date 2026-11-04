function run(v: Uint8Array, wanted: number): number { for (let i = v.length - 1; i >= 0; i--) { if (v[i] === wanted) return i; } return -1; }
function once(length: number, at: number): number { const v = new Uint8Array(length); for (let i = 0; i < length; i++) v[i] = i === at ? 200 : i % 100; return run(v, 200); }
for (let length = 0; length < 30; length++) { let said = ""; for (let at = -1; at <= length; at++) said += once(length, at) + " "; console.log(length, said); }
