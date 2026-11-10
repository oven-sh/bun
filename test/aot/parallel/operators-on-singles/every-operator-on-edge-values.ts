const edges = [0, -0, 1, -1, 0.5, 1.5, 0.1, 1 / 3, 16777216, 16777217, 16777219, 3.4028234663852886e38, 3.5e38, -3.4028234663852886e38, 1.401298464324817e-45, 1e-45, 7e-46, 1.1754943508222875e-38, 1.1754942106924411e-38, 2 ** -126, 2 ** -149, 2 ** 127, 1e300, -1e300, 5e-324, Infinity, -Infinity, NaN, 8388609.5, 4194304.25, 0.30000001192092896, 1.0000001192092896];
const a = new Float32Array(edges), n = a.length;
const out = new Float32Array(n * n), bits = new Uint32Array(out.buffer);
function sign(): string { let h = 2166136261; for (let i = 0; i < bits.length; i++) { const word = out[i] !== out[i] ? 0x7fc00000 : bits[i]; h = Math.imul(h ^ word, 16777619) >>> 0; } return h.toString(16); }
const said: string[] = [];
for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out[i * n + j] = a[i] + a[j]; said.push("add " + sign());
for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out[i * n + j] = a[i] - a[j]; said.push("sub " + sign());
for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out[i * n + j] = a[i] * a[j]; said.push("mul " + sign());
for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out[i * n + j] = a[i] / a[j]; said.push("div " + sign());
for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out[i * n + j] = Math.sqrt(a[i]); said.push("sqrt " + sign());
for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out[i * n + j] = a[i] * 0.5 + a[j]; said.push("half " + sign());
for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out[i * n + j] = Math.fround(Math.fround(a[i] * a[j]) + a[i]); said.push("fround " + sign());
console.log(said.join(" "));
