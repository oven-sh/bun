function run(v: Uint8Array): string { let h = 7; let i = v.length - 1; for (; i > -1; i -= 3) { if (v[i] === 200) break; h = (h * 31 + v[i]) | 0; } return h + ":" + i; }
function once(length: number, at: number): string { const v = new Uint8Array(length); for (let i = 0; i < length; i++) v[i] = i === at ? 200 : i % 100; return run(v); }
for (let length = 0; length < 60; length += length < 34 ? 1 : 7) { let said = ""; for (let at = -1; at <= length; at++) said += once(length, at) + " "; console.log(length, said); }
