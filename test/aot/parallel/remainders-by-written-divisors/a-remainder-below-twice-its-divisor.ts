// A dividend that is proven to lie from 0 up and below twice a written divisor leaves x or x - d: one test and one subtraction.
function ring(n: number): number { let head = 0, sum = 0; for (let i = 0; i < n; i++) { head = (head + 1) % 1000; sum = (sum + head) | 0; } return sum; }
function edge(n: number): string { let head = 0, said = ""; for (let i = 0; i < n; i++) { head = (head + 1) % 3; said += head; } return said; }
// `head + 1001` reaches 2000 and `v[i] + 3` reaches 258: exactly twice the divisor, whose remainder is 0.
function far(n: number): string { let head = 0, said = ""; for (let i = 0; i < n; i++) { head = (head + 1) % 1000; if (head > 996) said += (head + 1001) % 1000 + ","; } return said; }
function bytes(v: Uint8Array): string { let said = ""; for (let i = 0; i < v.length; i++) said += v[i] % 128 + "," + v[i] % 200 + "," + v[i] % 255 + "," + v[i] % 127 + "," + (v[i] + 3) % 129 + "," + (v[i] + 2) % 129 + ";"; return said; }
function wide(n: number): number { let head = 0; for (let i = 0; i < n; i++) head = (head + 1) % 2147483647; return head; }
console.log(ring(0), ring(1), ring(999), ring(1000), ring(2500), edge(7), wide(3), far(1000));
console.log(bytes(Uint8Array.of(0, 126, 127, 128, 199, 200, 253, 254, 255)));
(globalThis as any).keep = [ring, edge, far, bytes, wide];
