function nine(x: number, n: number): string { let t = ""; x = x % 10; for (let i = 0; i < n; i++) { x = (x + 10) % 10; t += x; } return t; }
function great(n: number): string { let x = 2147483646, t = ""; for (let i = 0; i < n; i++) { x = (x + 2147483646) % 2147483647; t += x + ","; } return t; }
function least(n: number): string { let x = 5, t = ""; for (let i = 0; i < n; i++) { x = (x + 9) % -10; t += x; } return t; }
function bytes(v: Uint8Array): string { let t = ""; for (let i = 0; i < v.length; i++) t += v[i] % 128 + "," + v[i] % 200 + "," + v[i] % 255 + ";"; return t; }
console.log(nine(9, 3), great(2), least(3), bytes(Uint8Array.of(0, 127, 128, 199, 200, 254, 255)));
