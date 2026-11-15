const text = `
const count = x => { let n = 0; for (let bit = 0x80000000; bit >= 1 && !(x & bit); bit /= 2) n++; return n; };
const numbers = [0, -0, NaN, Infinity, -Infinity, 1.5, -1.5, 4294967296, 4294967297, -4294967296.5, 1e300];
for (let k = 0; k < 32; k++) for (const d of [-2, -1, 0, 1, 2]) numbers.push((2 ** k + d) | 0, -(2 ** k) + d, (2 ** k + d) >>> 0);
for (let k = 0, x = 12345; k < 400; k++) { x = (Math.imul(x, 1103515245) + 12345) | 0; numbers.push(x, x >>> (k % 32)); }
let wrong = 0, sum = 0;
for (let t = 0; t < 3; t++) for (const x of numbers) { const c = Math.clz32(x); sum += c; if (c !== count(x >>> 0)) wrong++; }
[numbers.length, wrong, sum, Math.clz32(), Math.clz32(undefined), Math.clz32("8"), Math.clz32({ valueOf: () => 1 }), Math.clz32(1, 2)].join();
`;
for (let t = 0; t < 2; t++) console.log((0, eval)(text + "//" + t));
