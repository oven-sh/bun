function seven(n: number): string { let x = 7, t = 0; for (let i = 0; i < n; i++) { x = (x * 1103 + 12345) % 65536; t = (t + x) | 0; } return x + " " + t; }
function zero(n: number): string { let x = 0, t = 0; for (let i = 0; i < n; i++) { x = (x * 1103 + 12345) % 65536; t = (t + x) | 0; } return x + " " + t; }
function adler(v: Uint8Array): number { let a = 1, b = 0; for (let i = 0; i < v.length; i++) { a = (a + v[i]) % 65521; b = (b + a) % 65521; } return b * 65536 + a; }
console.log(seven(3), "|", zero(2), "|", seven(0), "|", adler(Uint8Array.of(97, 98, 99)));
