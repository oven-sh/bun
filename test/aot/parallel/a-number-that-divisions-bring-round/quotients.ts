function digits(n: number): number { let s = 0; while (n > 0) { s += n % 10; n = Math.floor(n / 10); } return s; }
function bits(n: number): number { let s = 0; while (n > 0) { s += n % 10; n = (n / 10) | 0; } return s; }
function halves(n: number): number { let s = 0; while (n) { n = (n / 2) | 0; s++; } return s; }
function literal(): number { let n = 12345, s = 0; while (n !== 0) { s = s * 10 + n % 10; n = Math.floor(n / 10); } return s; }
console.log(digits(12345), digits(0), digits(-5), digits(2.5), digits(2 ** 53), bits(4294967295), bits(907), halves(-7), halves(9), literal());
