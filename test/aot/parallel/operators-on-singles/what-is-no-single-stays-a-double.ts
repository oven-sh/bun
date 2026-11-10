const edges = [0, -0, 1, -1, 0.5, 1.5, 0.1, 1 / 3, 16777216, 16777217, 3.4028234663852886e38, 1.401298464324817e-45, 2 ** -126, 2 ** 127, Infinity, NaN, 8388609.5, 0.30000001192092896, 1.0000001192092896, 33554434, 12345.678];
const doubles = new Float64Array([0.1, 1 / 3, 1e-10, 1 + 2 ** -30, 16777217, 1e300, 5e-324, 0.7, 2 ** -150, 3.4028235677973366e38]);
const a = new Float32Array(edges), n = a.length, m = doubles.length;
const out = new Float32Array(n * m), bits = new Uint32Array(out.buffer);
function sign(): string { let h = 2166136261; for (let i = 0; i < bits.length; i++) { const word = out[i] !== out[i] ? 0x7fc00000 : bits[i]; h = Math.imul(h ^ word, 16777619) >>> 0; } return h.toString(16); }
const said: string[] = [];
for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) out[i * m + j] = a[i] * doubles[j]; said.push("by a double " + sign());
for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) out[i * m + j] = a[i] + doubles[j]; said.push("plus a double " + sign());
for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) out[i * m + j] = a[i] * 0.1; said.push("by 0.1 " + sign());
for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) out[i * m + j] = a[i] / 3.3; said.push("over 3.3 " + sign());
for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) out[i * m + j] = a[i] * a[i] * a[i]; said.push("three factors " + sign());
for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) out[i * m + j] = a[i] * a[i] + a[(i + j) % n]; said.push("product and sum " + sign());
let kept = 0; for (let i = 0; i < n; i++) { const product = a[i] * a[(i + 1) % n]; out[i] = product; if (product === product && Math.abs(product) < 1e30) kept += product; } said.push("read twice " + sign() + " " + kept);
console.log(said.join(" "));
